package audit

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ClusterFinding is one security-relevant observation about a cluster.
type ClusterFinding struct {
	Category string `json:"category"` // workload | rbac | network | version
	Severity string `json:"severity"` // info | low | medium | high
	Resource string `json:"resource"` // e.g. "pod default/nginx", "clusterrolebinding foo"
	Detail   string `json:"detail"`
}

// ClusterAuditResult is the full cluster security report.
type ClusterAuditResult struct {
	ServerVersion string           `json:"server_version"`
	ScannedAt     time.Time        `json:"scanned_at"`
	Findings      []ClusterFinding `json:"findings"`
	FindingCount  int              `json:"finding_count"`
	HighCount     int              `json:"high_count"`
}

// knownEOLMinors is a small, point-in-time list of Kubernetes minor versions
// past community support at the time this list was last updated — not a live
// feed. Cross-check against the official support policy before acting.
var knownEOLMinors = map[int]bool{
	20: true, 21: true, 22: true, 23: true, 24: true, 25: true, 26: true,
}

// ScanCluster runs a set of read-only List/Get calls against a live cluster
// and reports workload, RBAC, and network-exposure risks.
func ScanCluster(clientset *kubernetes.Clientset) (ClusterAuditResult, error) {
	ctx := context.Background()
	result := ClusterAuditResult{ScannedAt: time.Now()}

	if v, err := clientset.Discovery().ServerVersion(); err == nil {
		result.ServerVersion = v.String()
		if minor, ok := parseMinor(v.Minor); ok && knownEOLMinors[minor] {
			result.Findings = append(result.Findings, ClusterFinding{
				Category: "version", Severity: "medium", Resource: "cluster",
				Detail: fmt.Sprintf("Kubernetes %s is past its community-supported minor version window (point-in-time check, verify against current upstream support policy)", v.String()),
			})
		}
	}

	if pods, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, pod := range pods.Items {
			ref := fmt.Sprintf("pod %s/%s", pod.Namespace, pod.Name)
			if pod.Spec.HostNetwork {
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "workload", Severity: "high", Resource: ref,
					Detail: "Pod runs with hostNetwork: true, sharing the node's network namespace",
				})
			}
			if pod.Spec.HostPID {
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "workload", Severity: "high", Resource: ref,
					Detail: "Pod runs with hostPID: true, sharing the node's PID namespace",
				})
			}
			for _, ctr := range pod.Spec.Containers {
				cref := fmt.Sprintf("%s container %s", ref, ctr.Name)
				if ctr.SecurityContext != nil {
					if ctr.SecurityContext.Privileged != nil && *ctr.SecurityContext.Privileged {
						result.Findings = append(result.Findings, ClusterFinding{
							Category: "workload", Severity: "high", Resource: cref,
							Detail: "Container runs privileged: true",
						})
					}
					if ctr.SecurityContext.RunAsUser != nil && *ctr.SecurityContext.RunAsUser == 0 {
						result.Findings = append(result.Findings, ClusterFinding{
							Category: "workload", Severity: "medium", Resource: cref,
							Detail: "Container explicitly runs as UID 0 (root)",
						})
					}
				}
				if ctr.Resources.Limits.Cpu().IsZero() && ctr.Resources.Limits.Memory().IsZero() {
					result.Findings = append(result.Findings, ClusterFinding{
						Category: "workload", Severity: "low", Resource: cref,
						Detail: "Container has no CPU/memory resource limits set",
					})
				}
			}
		}
	}

	if crbs, err := clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{}); err == nil {
		for _, crb := range crbs.Items {
			if crb.RoleRef.Name != "cluster-admin" {
				continue
			}
			for _, sub := range crb.Subjects {
				if strings.HasPrefix(sub.Name, "system:") || strings.HasPrefix(sub.Namespace, "kube-") {
					continue
				}
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "rbac", Severity: "high", Resource: "clusterrolebinding " + crb.Name,
					Detail: fmt.Sprintf("Binds cluster-admin to %s %s/%s", sub.Kind, sub.Namespace, sub.Name),
				})
			}
		}
	}

	if sas, err := clientset.CoreV1().ServiceAccounts("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, sa := range sas.Items {
			if sa.Name != "default" {
				continue
			}
			if sa.AutomountServiceAccountToken == nil || *sa.AutomountServiceAccountToken {
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "rbac", Severity: "low", Resource: fmt.Sprintf("serviceaccount %s/default", sa.Namespace),
					Detail: "Default ServiceAccount does not explicitly disable automountServiceAccountToken",
				})
			}
		}
	}

	if svcs, err := clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, svc := range svcs.Items {
			switch svc.Spec.Type {
			case corev1.ServiceTypeLoadBalancer:
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "network", Severity: "low", Resource: fmt.Sprintf("service %s/%s", svc.Namespace, svc.Name),
					Detail: "Service is exposed via a LoadBalancer",
				})
			case corev1.ServiceTypeNodePort:
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "network", Severity: "low", Resource: fmt.Sprintf("service %s/%s", svc.Namespace, svc.Name),
					Detail: "Service is exposed via a NodePort on every node",
				})
			}
		}
	}

	if nsList, err := clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{}); err == nil {
		npByNS := map[string]int{}
		if npList, err := clientset.NetworkingV1().NetworkPolicies("").List(ctx, metav1.ListOptions{}); err == nil {
			for _, np := range npList.Items {
				npByNS[np.Namespace]++
			}
		}
		for _, ns := range nsList.Items {
			if strings.HasPrefix(ns.Name, "kube-") {
				continue
			}
			if npByNS[ns.Name] == 0 {
				result.Findings = append(result.Findings, ClusterFinding{
					Category: "network", Severity: "low", Resource: "namespace " + ns.Name,
					Detail: "Namespace has no NetworkPolicy — no default-deny in place",
				})
			}
		}
	}

	result.FindingCount = len(result.Findings)
	for _, f := range result.Findings {
		if f.Severity == "high" {
			result.HighCount++
		}
	}
	return result, nil
}

func parseMinor(minor string) (int, bool) {
	trimmed := strings.TrimRight(minor, "+")
	n, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0, false
	}
	return n, true
}
