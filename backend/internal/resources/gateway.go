package resources

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/infra-eye/backend/internal/config"
)

const defaultDialTimeout = 15 * time.Second

func dialDirect(host string, port int) (net.Conn, error) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	dialer := &net.Dialer{Timeout: defaultDialTimeout, KeepAlive: 30 * time.Second}
	return dialer.Dial("tcp", addr)
}

func dialViaGateway(host string, port int) (net.Conn, error) {
	proxyURL, err := url.Parse(config.C.ResourceGatewayURL)
	if err != nil {
		return nil, fmt.Errorf("invalid gateway URL: %w", err)
	}
	if proxyURL.Scheme != "http" && proxyURL.Scheme != "https" {
		return nil, fmt.Errorf("unsupported gateway scheme: %s", proxyURL.Scheme)
	}

	proxyHost := proxyURL.Host
	if proxyHost == "" {
		return nil, fmt.Errorf("gateway URL must include host:port")
	}

	dialer := &net.Dialer{Timeout: defaultDialTimeout, KeepAlive: 30 * time.Second}
	conn, err := dialer.Dial("tcp", proxyHost)
	if err != nil {
		return nil, fmt.Errorf("dial gateway %s: %w", proxyHost, err)
	}

	if proxyURL.Scheme == "https" {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: proxyURL.Hostname()})
		if err := tlsConn.Handshake(); err != nil {
			conn.Close()
			return nil, fmt.Errorf("gateway TLS handshake failed: %w", err)
		}
		conn = tlsConn
	}

	target := net.JoinHostPort(host, strconv.Itoa(port))
	reqLines := []string{
		fmt.Sprintf("CONNECT %s HTTP/1.1", target),
		fmt.Sprintf("Host: %s", target),
	}
	if token := strings.TrimSpace(config.C.ResourceGatewayToken); token != "" {
		reqLines = append(reqLines, fmt.Sprintf("Proxy-Authorization: Bearer %s", token))
	}
	reqLines = append(reqLines, "", "")
	if _, err := conn.Write([]byte(strings.Join(reqLines, "\r\n"))); err != nil {
		conn.Close()
		return nil, fmt.Errorf("send CONNECT to gateway: %w", err)
	}

	reader := bufio.NewReader(conn)
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("read gateway response: %w", err)
	}
	if !strings.Contains(statusLine, "200") {
		body, _ := io.ReadAll(io.LimitReader(reader, 4096))
		conn.Close()
		return nil, fmt.Errorf("gateway connect failed: %s %s", strings.TrimSpace(statusLine), strings.TrimSpace(string(body)))
	}

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("read gateway headers: %w", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}

	return conn, nil
}

// DialResource opens a TCP connection to the target resource either directly or through the configured gateway.
func DialResource(host string, port int, useGateway bool) (net.Conn, error) {
	if host == "" || port == 0 {
		return nil, fmt.Errorf("host and port must be provided")
	}
	if useGateway && config.C.ResourceGatewayURL != "" {
		return dialViaGateway(host, port)
	}
	return dialDirect(host, port)
}

// HTTPReachable verifies an HTTP(S) endpoint over the chosen transport.
func HTTPReachable(ctx context.Context, host string, port int, scheme string, useGateway bool) error {
	if scheme == "" {
		scheme = "http"
	}

	dialContext := func(_ context.Context, _, _ string) (net.Conn, error) {
		return DialResource(host, port, useGateway)
	}

	transport := &http.Transport{DialContext: dialContext}
	client := &http.Client{Timeout: 10 * time.Second, Transport: transport}

	url := fmt.Sprintf("%s://%s:%d/", scheme, host, port)
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("http status %s", resp.Status)
	}
	return nil
}
