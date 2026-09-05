package audit

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"time"

	"github.com/infra-eye/backend/internal/models"
)

// ResourceFinding is one exposure/auth/TLS verdict for a Resource.
type ResourceFinding struct {
	Check    string `json:"check"`
	Severity string `json:"severity"` // info | low | medium | high
	Passed   bool   `json:"passed"`
	Detail   string `json:"detail"`
}

// ResourceAuditResult is the full security report for one Resource.
type ResourceAuditResult struct {
	ScannedAt time.Time         `json:"scanned_at"`
	Findings  []ResourceFinding `json:"findings"`
	FailCount int               `json:"fail_count"`
}

const resourceDialTimeout = 5 * time.Second

// ScanResource probes a Resource's live reachability, auth posture, and (for
// TLS-capable protocols) certificate health. Passive/read-only: it only
// dials and, for TLS, completes a handshake — no credentials are guessed or
// submitted.
func ScanResource(res models.Resource) (ResourceAuditResult, error) {
	// Findings starts as an empty (non-nil) slice — a nil one marshals to
	// JSON `null`, and the frontend calls .length/.map on it unconditionally
	// once a result exists, which crashes the page on a clean scan.
	result := ResourceAuditResult{ScannedAt: time.Now(), Findings: []ResourceFinding{}}

	directlyReachable := false
	if conn, err := dialWithTimeout(res.Host, res.Port); err == nil {
		directlyReachable = true
		conn.Close()
	}

	if res.UseGateway {
		result.Findings = append(result.Findings, ResourceFinding{
			Check: "gateway-routed", Severity: "medium", Passed: !directlyReachable,
			Detail: pickDetail(!directlyReachable,
				"Resource is configured to route through the gateway and is not directly reachable from the backend",
				fmt.Sprintf("Resource is configured to use the gateway, but %s:%d is also directly reachable, bypassing it", res.Host, res.Port)),
		})
	} else {
		result.Findings = append(result.Findings, ResourceFinding{
			Check: "gateway-routed", Severity: "info", Passed: true,
			Detail: "Resource is configured for direct connection (gateway not used)",
		})
	}

	authNone := res.AuthType == "" || res.AuthType == "none"
	authConfigured := !authNone
	reachability := "not directly reachable from the backend at scan time"
	if directlyReachable {
		reachability = "directly reachable from the backend"
	}
	result.Findings = append(result.Findings, ResourceFinding{
		Check: "auth-configured", Severity: "high", Passed: authConfigured,
		Detail: pickDetail(authConfigured,
			fmt.Sprintf("Auth type is set (%s)", res.AuthType),
			fmt.Sprintf("No authentication is configured for %s:%d, which is %s", res.Host, res.Port, reachability)),
	})

	if res.Protocol == "https" {
		state, err := tlsHandshake(res.Host, res.Port)
		if err != nil {
			result.Findings = append(result.Findings, ResourceFinding{
				Check: "tls-handshake", Severity: "medium", Passed: false,
				Detail: "TLS handshake failed: " + err.Error(),
			})
		} else {
			result.Findings = append(result.Findings, tlsVersionFinding(state.Version))
			if len(state.PeerCertificates) > 0 {
				result.Findings = append(result.Findings, tlsCertFindings(state.PeerCertificates[0])...)
			}
		}
	}

	for _, f := range result.Findings {
		if !f.Passed {
			result.FailCount++
		}
	}
	return result, nil
}

func dialWithTimeout(host string, port int) (net.Conn, error) {
	return net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), resourceDialTimeout)
}

func tlsHandshake(host string, port int) (tls.ConnectionState, error) {
	dialer := &net.Dialer{Timeout: resourceDialTimeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", fmt.Sprintf("%s:%d", host, port), &tls.Config{InsecureSkipVerify: true})
	if err != nil {
		return tls.ConnectionState{}, err
	}
	defer conn.Close()
	return conn.ConnectionState(), nil
}

func tlsVersionFinding(version uint16) ResourceFinding {
	modern := version >= tls.VersionTLS12
	return ResourceFinding{
		Check: "tls-version", Severity: "high", Passed: modern,
		Detail: pickDetail(modern,
			"Negotiated TLS 1.2 or newer",
			fmt.Sprintf("Negotiated TLS version below 1.2 (raw version 0x%04x)", version)),
	}
}

func tlsCertFindings(cert *x509.Certificate) []ResourceFinding {
	findings := []ResourceFinding{}

	daysLeft := int(time.Until(cert.NotAfter).Hours() / 24)
	expiringSoon := daysLeft < 30
	findings = append(findings, ResourceFinding{
		Check: "tls-cert-expiry", Severity: "high", Passed: !expiringSoon,
		Detail: pickDetail(!expiringSoon,
			fmt.Sprintf("Certificate valid for %d more days (expires %s)", daysLeft, cert.NotAfter.Format("2006-01-02")),
			fmt.Sprintf("Certificate expires in %d days (%s)", daysLeft, cert.NotAfter.Format("2006-01-02"))),
	})

	selfSigned := cert.Issuer.String() == cert.Subject.String()
	findings = append(findings, ResourceFinding{
		Check: "tls-cert-self-signed", Severity: "low", Passed: !selfSigned,
		Detail: pickDetail(!selfSigned,
			"Certificate is signed by a distinct issuer",
			"Certificate is self-signed (issuer matches subject)"),
	})

	return findings
}
