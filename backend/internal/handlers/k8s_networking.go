package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type K8sServicePort struct {
	Name       string `json:"name"`
	Protocol   string `json:"protocol"`
	Port       int32  `json:"port"`
	TargetPort string `json:"target_port"`
	NodePort   int32  `json:"node_port,omitempty"`
}

type K8sServiceInfo struct {
	Name        string           `json:"name"`
	Namespace   string           `json:"namespace"`
	Type        string           `json:"type"`
	ClusterIP   string           `json:"cluster_ip"`
	ExternalIPs []string         `json:"external_ips"`
	Ports       []K8sServicePort `json:"ports"`
}

type K8sIngressInfo struct {
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	Class     string   `json:"class"`
	Hosts     []string `json:"hosts"`
	Addresses []string `json:"addresses"`
}

type K8sNetworkPolicyInfo struct {
	Name        string   `json:"name"`
	Namespace   string   `json:"namespace"`
	PodSelector string   `json:"pod_selector"`
	PolicyTypes []string `json:"policy_types"`
}

type K8sNodeNetworkInfo struct {
	Name       string `json:"name"`
	InternalIP string `json:"internal_ip"`
	ExternalIP string `json:"external_ip"`
	PodCIDR    string `json:"pod_cidr"`
	Ready      bool   `json:"ready"`
	KubeletVer string `json:"kubelet_version"`
}

type K8sDNSInfo struct {
	Provider        string `json:"provider"`
	DeploymentReady bool   `json:"deployment_ready"`
	ReadyReplicas   int32  `json:"ready_replicas"`
	DesiredReplicas int32  `json:"desired_replicas"`
	ClusterIP       string `json:"cluster_ip"`
}

type K8sCNIInfo struct {
	Provider  string `json:"provider"`
	Ready     bool   `json:"ready"`
	Desired   int32  `json:"desired"`
	Scheduled int32  `json:"scheduled"`
}

type K8sNetworkingSummary struct {
	Services         int `json:"services"`
	ClusterIPSvcs    int `json:"cluster_ip_services"`
	NodePortSvcs     int `json:"node_port_services"`
	LoadBalancerSvcs int `json:"load_balancer_services"`
	Ingresses        int `json:"ingresses"`
	NetworkPolicies  int `json:"network_policies"`
	Nodes            int `json:"nodes"`
}

type K8sNetworkingInfo struct {
	PodCIDRs        []string               `json:"pod_cidrs"`
	ServiceCIDR     string                 `json:"service_cidr"`
	DNS             K8sDNSInfo             `json:"dns"`
	CNI             K8sCNIInfo             `json:"cni"`
	Nodes           []K8sNodeNetworkInfo   `json:"nodes"`
	Services        []K8sServiceInfo       `json:"services"`
	Ingresses       []K8sIngressInfo       `json:"ingresses"`
	NetworkPolicies []K8sNetworkPolicyInfo `json:"network_policies"`
	Summary         K8sNetworkingSummary   `json:"summary"`
}

// knownCNIDaemonSets maps common kube-system DaemonSet name prefixes to a
// human-readable CNI plugin name, used for best-effort detection since there
// is no single authoritative API for "which CNI is installed".
var knownCNIDaemonSets = []struct {
	prefix string
	name   string
}{
	{"cilium", "Cilium"},
	{"calico-node", "Calico"},
	{"kube-flannel", "Flannel"},
	{"weave-net", "Weave Net"},
	{"aws-node", "AWS VPC CNI"},
	{"azure-cni", "Azure CNI"},
	{"antrea", "Antrea"},
	{"kube-router", "Kube-router"},
	{"canal", "Canal"},
}

func GetK8sNetworking(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	if !server.IsK8s || server.KubeConfig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "networking info requires a Kubernetes-connected cluster"})
		return
	}

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return
	}

	ctx := context.Background()
	info := K8sNetworkingInfo{PodCIDRs: []string{}, Nodes: []K8sNodeNetworkInfo{}}

	// ── Nodes: pod CIDRs + per-node addresses ──
	if nodeList, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); err == nil {
		podCIDRSet := map[string]bool{}
		for _, n := range nodeList.Items {
			node := K8sNodeNetworkInfo{Name: n.Name, PodCIDR: n.Spec.PodCIDR, KubeletVer: n.Status.NodeInfo.KubeletVersion}
			for _, addr := range n.Status.Addresses {
				if addr.Type == corev1.NodeInternalIP {
					node.InternalIP = addr.Address
				} else if addr.Type == corev1.NodeExternalIP {
					node.ExternalIP = addr.Address
				}
			}
			for _, cond := range n.Status.Conditions {
				if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
					node.Ready = true
				}
			}
			if n.Spec.PodCIDR != "" {
				podCIDRSet[n.Spec.PodCIDR] = true
			}
			info.Nodes = append(info.Nodes, node)
		}
		for cidr := range podCIDRSet {
			info.PodCIDRs = append(info.PodCIDRs, cidr)
		}
		info.Summary.Nodes = len(nodeList.Items)
	}

	// ── Service CIDR: derive from the default "kubernetes" service's ClusterIP range hint ──
	if kubeSvc, err := clientset.CoreV1().Services("default").Get(ctx, "kubernetes", metav1.GetOptions{}); err == nil {
		if idx := strings.LastIndex(kubeSvc.Spec.ClusterIP, "."); idx > 0 {
			info.ServiceCIDR = kubeSvc.Spec.ClusterIP[:idx] + ".0.0/16"
		}
	}

	// ── Services (all namespaces) ──
	if svcList, err := clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, s := range svcList.Items {
			svc := K8sServiceInfo{
				Name: s.Name, Namespace: s.Namespace, Type: string(s.Spec.Type),
				ClusterIP: s.Spec.ClusterIP, ExternalIPs: s.Spec.ExternalIPs,
				Ports: []K8sServicePort{},
			}
			if svc.ExternalIPs == nil {
				svc.ExternalIPs = []string{}
			}
			for _, ing := range s.Status.LoadBalancer.Ingress {
				if ing.IP != "" {
					svc.ExternalIPs = append(svc.ExternalIPs, ing.IP)
				}
				if ing.Hostname != "" {
					svc.ExternalIPs = append(svc.ExternalIPs, ing.Hostname)
				}
			}
			for _, p := range s.Spec.Ports {
				svc.Ports = append(svc.Ports, K8sServicePort{
					Name: p.Name, Protocol: string(p.Protocol), Port: p.Port,
					TargetPort: p.TargetPort.String(), NodePort: p.NodePort,
				})
			}
			switch s.Spec.Type {
			case corev1.ServiceTypeClusterIP, "":
				info.Summary.ClusterIPSvcs++
			case corev1.ServiceTypeNodePort:
				info.Summary.NodePortSvcs++
			case corev1.ServiceTypeLoadBalancer:
				info.Summary.LoadBalancerSvcs++
			}
			info.Services = append(info.Services, svc)

			// Detect DNS service while we're already iterating services.
			if s.Namespace == "kube-system" && (s.Name == "kube-dns" || s.Name == "coredns") {
				info.DNS.ClusterIP = s.Spec.ClusterIP
			}
		}
		info.Summary.Services = len(svcList.Items)
	}
	if info.Services == nil {
		info.Services = []K8sServiceInfo{}
	}

	// ── Ingresses (all namespaces) ──
	if ingList, err := clientset.NetworkingV1().Ingresses("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, ing := range ingList.Items {
			item := K8sIngressInfo{Name: ing.Name, Namespace: ing.Namespace, Hosts: []string{}, Addresses: []string{}}
			if ing.Spec.IngressClassName != nil {
				item.Class = *ing.Spec.IngressClassName
			}
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					item.Hosts = append(item.Hosts, rule.Host)
				}
			}
			for _, lb := range ing.Status.LoadBalancer.Ingress {
				if lb.IP != "" {
					item.Addresses = append(item.Addresses, lb.IP)
				}
				if lb.Hostname != "" {
					item.Addresses = append(item.Addresses, lb.Hostname)
				}
			}
			info.Ingresses = append(info.Ingresses, item)
		}
		info.Summary.Ingresses = len(ingList.Items)
	}
	if info.Ingresses == nil {
		info.Ingresses = []K8sIngressInfo{}
	}

	// ── NetworkPolicies (all namespaces) ──
	if npList, err := clientset.NetworkingV1().NetworkPolicies("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, np := range npList.Items {
			selector := "(all pods)"
			if len(np.Spec.PodSelector.MatchLabels) > 0 {
				pairs := make([]string, 0, len(np.Spec.PodSelector.MatchLabels))
				for k, v := range np.Spec.PodSelector.MatchLabels {
					pairs = append(pairs, k+"="+v)
				}
				selector = strings.Join(pairs, ",")
			}
			types := make([]string, 0, len(np.Spec.PolicyTypes))
			for _, t := range np.Spec.PolicyTypes {
				types = append(types, string(t))
			}
			info.NetworkPolicies = append(info.NetworkPolicies, K8sNetworkPolicyInfo{
				Name: np.Name, Namespace: np.Namespace, PodSelector: selector, PolicyTypes: types,
			})
		}
		info.Summary.NetworkPolicies = len(npList.Items)
	}
	if info.NetworkPolicies == nil {
		info.NetworkPolicies = []K8sNetworkPolicyInfo{}
	}

	// ── CoreDNS status ──
	if dep, err := clientset.AppsV1().Deployments("kube-system").Get(ctx, "coredns", metav1.GetOptions{}); err == nil {
		info.DNS.Provider = "CoreDNS"
		desired := int32(1)
		if dep.Spec.Replicas != nil {
			desired = *dep.Spec.Replicas
		}
		info.DNS.DesiredReplicas = desired
		info.DNS.ReadyReplicas = dep.Status.ReadyReplicas
		info.DNS.DeploymentReady = desired == 0 || dep.Status.ReadyReplicas >= desired
	} else if dep, err := clientset.AppsV1().Deployments("kube-system").Get(ctx, "kube-dns", metav1.GetOptions{}); err == nil {
		info.DNS.Provider = "kube-dns"
		desired := int32(1)
		if dep.Spec.Replicas != nil {
			desired = *dep.Spec.Replicas
		}
		info.DNS.DesiredReplicas = desired
		info.DNS.ReadyReplicas = dep.Status.ReadyReplicas
		info.DNS.DeploymentReady = desired == 0 || dep.Status.ReadyReplicas >= desired
	} else {
		info.DNS.Provider = "Unknown"
	}

	// ── CNI plugin detection via kube-system DaemonSets ──
	if dsList, err := clientset.AppsV1().DaemonSets("kube-system").List(ctx, metav1.ListOptions{}); err == nil {
		for _, ds := range dsList.Items {
			for _, known := range knownCNIDaemonSets {
				if strings.HasPrefix(ds.Name, known.prefix) {
					info.CNI.Provider = known.name
					info.CNI.Desired = ds.Status.DesiredNumberScheduled
					info.CNI.Scheduled = ds.Status.NumberReady
					info.CNI.Ready = ds.Status.DesiredNumberScheduled == 0 || ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled
					break
				}
			}
			if info.CNI.Provider != "" {
				break
			}
		}
	}
	if info.CNI.Provider == "" {
		info.CNI.Provider = "Unknown"
	}

	c.JSON(http.StatusOK, info)
}
