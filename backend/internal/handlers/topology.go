package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// The topology endpoint assembles the full infrastructure blueprint: every
// server, cluster, and cataloged resource the requesting user may see, the
// edges between them, and the network segments they sit on. Static edges
// (management links, resource placement by matching hosts) come straight from
// the database; network membership is derived from declared addresses (plus
// DNS resolution). With ?live=true it also SSHes into each reachable server
// to read established TCP connections and the real interface CIDRs, and lists
// the nodes of each connected Kubernetes cluster. With ?live=true&discover=true
// it additionally runs an nmap ping sweep (from one server per real segment)
// to surface other real devices on that network InfraEye doesn't manage —
// only ever run on explicit opt-in, since it actively probes the network.
// Real observed state is never cached across requests (see
// docs/DESIGN_PRINCIPLES.md); scan failures are reported verbatim in Notes
// rather than swallowed.

type TopologyNode struct {
	ID           string   `json:"id"`
	Kind         string   `json:"kind"` // core | server | cluster | resource | k8s_node | discovered
	RefID        uint     `json:"ref_id,omitempty"`
	Name         string   `json:"name"`
	Host         string   `json:"host,omitempty"`
	Port         int      `json:"port,omitempty"`
	Status       string   `json:"status,omitempty"`
	OS           string   `json:"os,omitempty"`
	Distro       string   `json:"distro,omitempty"`
	ResourceType string   `json:"resource_type,omitempty"`
	Protocol     string   `json:"protocol,omitempty"`
	FolderID     *uint    `json:"folder_id,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	Detail       string   `json:"detail,omitempty"`
	// Networks lists the IDs of every TopologyNetwork this node has an
	// address on (first entry is the primary placement in the map).
	Networks []string `json:"networks,omitempty"`
}

type TopologyEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"` // manage | hosted_on | network | member | discovered
	Label  string `json:"label,omitempty"`
}

// TopologyNetwork is one network segment nodes can belong to. Segments come
// from real interface CIDRs when a live scan provided them (Source names the
// servers they were read from); otherwise private IPv4 addresses are bucketed
// into an assumed /24 — labeled as such, since it is a guess, not a fact.
type TopologyNetwork struct {
	ID     string `json:"id"`
	CIDR   string `json:"cidr"`
	Label  string `json:"label"`
	Kind   string `json:"kind"` // private | vpn | public | loopback
	Source string `json:"source,omitempty"`
}

type TopologyGraph struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Live        bool              `json:"live"`
	Folders     []models.Folder   `json:"folders"`
	Networks    []TopologyNetwork `json:"networks"`
	Nodes       []TopologyNode    `json:"nodes"`
	Edges       []TopologyEdge    `json:"edges"`
	Notes       []string          `json:"notes,omitempty"`
}

const topologyScanTimeout = 12 * time.Second

// Established-connections scripts print one "ip:port" remote endpoint per line.
const linuxEstabScript = `
if command -v ss >/dev/null 2>&1; then
  ss -Htn state established 2>/dev/null | awk '{print $4}'
elif command -v netstat >/dev/null 2>&1; then
  netstat -tn 2>/dev/null | awk '$6=="ESTABLISHED"{print $5}'
fi
`

const darwinEstabScript = `netstat -an -p tcp 2>/dev/null | awk '$6=="ESTABLISHED"{print $5}'`

const windowsEstabScript = `powershell -NoProfile -NonInteractive -Command "Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | ForEach-Object { $_.RemoteAddress + ':' + $_.RemotePort }"`

// Interface scripts print one IPv4 address per line, with its prefix:
// "10.0.0.11/24" on linux/windows, "10.0.0.11 0xffffff00" on macOS.
// The linux form avoids `ip -o` and scope filters so it also works on
// busybox (Alpine containers); loopback/link-local are filtered Go-side.
const linuxIfaceNetScript = `
if command -v ip >/dev/null 2>&1; then
  ip -4 addr show 2>/dev/null | awk '/inet /{print $2}'
elif command -v ifconfig >/dev/null 2>&1; then
  ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2, $4}'
fi
`

const darwinIfaceNetScript = `ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2, $4}'`

const windowsIfaceNetScript = `powershell -NoProfile -NonInteractive -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress + '/' + $_.PrefixLength }"`

func GetTopology(c *gin.Context) {
	role := c.GetString("role")
	userID := c.GetUint("user_id")
	live := c.Query("live") == "true"
	discover := live && c.Query("discover") == "true"

	var servers []models.Server
	if role == "admin" || role == "devops" {
		db.DB.Find(&servers)
	} else {
		db.DB.Joins("JOIN server_accesses ON server_accesses.server_id = servers.id AND server_accesses.user_id = ? AND server_accesses.deleted_at IS NULL", userID).
			Find(&servers)
	}

	// Resource visibility matches the /api/resources route gate.
	var resources []models.Resource
	if role == "admin" || role == "devops" || role == "trainee" {
		db.DB.Find(&resources)
	}

	var folders []models.Folder
	db.DB.Find(&folders)

	graph := TopologyGraph{
		GeneratedAt: time.Now(),
		Live:        live,
		Folders:     folders,
		Networks:    []TopologyNetwork{},
		Nodes:       []TopologyNode{},
		Edges:       []TopologyEdge{},
	}

	graph.Nodes = append(graph.Nodes, TopologyNode{
		ID:     "infraeye",
		Kind:   "core",
		Name:   "InfraEye",
		Detail: "control plane",
	})

	// hostToNode maps every declared address to the node that owns it, for
	// matching observed connections and resource placement.
	hostToNode := map[string]string{}
	nodePort := map[string]int{}

	for _, s := range servers {
		id := fmt.Sprintf("server-%d", s.ID)
		kind := "server"
		if s.IsK8s {
			kind = "cluster"
		}
		node := TopologyNode{
			ID:       id,
			Kind:     kind,
			RefID:    s.ID,
			Name:     s.Name,
			Host:     s.Host,
			Port:     s.Port,
			Status:   s.Status,
			OS:       s.OS,
			Distro:   s.Distro,
			FolderID: s.FolderID,
			Tags:     splitTags(s.Tags),
			Detail:   s.DistroPrettyName,
		}
		graph.Nodes = append(graph.Nodes, node)
		if s.Host != "" {
			hostToNode[s.Host] = id
		}

		label := ""
		switch {
		case s.IsK8s && s.Host != "":
			label = fmt.Sprintf("SSH :%d + kubeconfig", s.Port)
		case s.IsK8s:
			label = "kubeconfig"
		default:
			label = fmt.Sprintf("SSH :%d", s.Port)
		}
		graph.Edges = append(graph.Edges, TopologyEdge{
			Source: "infraeye", Target: id, Kind: "manage", Label: label,
		})
	}

	for _, r := range resources {
		id := fmt.Sprintf("resource-%d", r.ID)
		graph.Nodes = append(graph.Nodes, TopologyNode{
			ID:           id,
			Kind:         "resource",
			RefID:        r.ID,
			Name:         r.Name,
			Host:         r.Host,
			Port:         r.Port,
			Status:       r.Status,
			ResourceType: r.ResourceType,
			Protocol:     r.Protocol,
			FolderID:     r.FolderID,
			Tags:         splitTags(r.Tags),
		})
		if r.Host != "" {
			// Servers claim the address first; don't let a resource shadow one.
			if _, taken := hostToNode[r.Host]; !taken {
				hostToNode[r.Host] = id
			}
			nodePort[id] = r.Port
		}

		// A resource whose host is a managed server lives on that server;
		// otherwise InfraEye probes it directly (or via the gateway).
		if serverNode, ok := hostToNode[r.Host]; ok && strings.HasPrefix(serverNode, "server-") {
			graph.Edges = append(graph.Edges, TopologyEdge{
				Source: id, Target: serverNode, Kind: "hosted_on",
				Label: fmt.Sprintf("%s :%d", r.Protocol, r.Port),
			})
		} else {
			label := "probe"
			if r.UseGateway {
				label = "probe via gateway"
			}
			graph.Edges = append(graph.Edges, TopologyEdge{
				Source: "infraeye", Target: id, Kind: "manage", Label: label,
			})
		}
	}

	// Resolve every declared host to IPs (literal IPs parse immediately, DNS
	// names get a short concurrent lookup) so hostname-addressed machines
	// still land on the right network segment and match observed traffic.
	nodeIPs, ipToNode := resolveNodeAddresses(hostToNode)

	// ifaceNets holds the real interface CIDRs known for each server, keyed
	// by node ID; scanTimes records when each set was read. Cached results
	// from earlier live scans seed the map so the network view shows real
	// segments even on a plain page load; a live scan re-reads and replaces
	// them.
	ifaceNets := map[string][]*net.IPNet{}
	scanTimes := map[string]time.Time{}
	// selfIPs holds each server's exact interface addresses (unmasked), so
	// discovery can recognize "this nmap hit is the scanning server itself"
	// even when the server's declared host (how InfraEye reaches it — a
	// port-forward, NAT, or localhost mapping) differs from its real IP.
	selfIPs := map[string][]net.IP{}
	serverIDs := make([]uint, 0, len(servers))
	for _, s := range servers {
		serverIDs = append(serverIDs, s.ID)
	}
	var cached []models.NetworkScan
	if len(serverIDs) > 0 {
		db.DB.Where("server_id IN ?", serverIDs).Find(&cached)
	}
	for _, ns := range cached {
		id := fmt.Sprintf("server-%d", ns.ServerID)
		var cidrs []string
		if err := json.Unmarshal([]byte(ns.CIDRs), &cidrs); err != nil {
			continue
		}
		for _, c := range cidrs {
			if _, n, err := net.ParseCIDR(c); err == nil {
				ifaceNets[id] = append(ifaceNets[id], n)
			}
		}
		scanTimes[id] = ns.ScannedAt
	}

	if live {
		runLiveScans(&graph, servers, ipToNode, nodePort, ifaceNets, scanTimes, selfIPs)
	}

	buildNetworks(&graph, nodeIPs, ifaceNets, scanTimes)

	if discover {
		runNetworkDiscovery(&graph, servers, ifaceNets, ipToNode, selfIPs)
	}

	c.JSON(http.StatusOK, graph)
}

// resolveNodeAddresses turns declared hosts into IPs per node, plus the
// reverse ip→node index used to match observed connections. DNS lookups run
// concurrently with a short timeout so unresolvable names can't stall the map.
func resolveNodeAddresses(hostToNode map[string]string) (map[string][]net.IP, map[string]string) {
	nodeIPs := map[string][]net.IP{}
	ipToNode := map[string]string{}
	var mu sync.Mutex
	var wg sync.WaitGroup

	for host, nodeID := range hostToNode {
		ipToNode[host] = nodeID
		if ip := net.ParseIP(host); ip != nil {
			nodeIPs[nodeID] = append(nodeIPs[nodeID], ip)
			continue
		}
		wg.Add(1)
		go func(host, nodeID string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			addrs, err := net.DefaultResolver.LookupHost(ctx, host)
			if err != nil {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, a := range addrs {
				if ip := net.ParseIP(a); ip != nil {
					nodeIPs[nodeID] = append(nodeIPs[nodeID], ip)
				}
				if _, taken := ipToNode[a]; !taken {
					ipToNode[a] = nodeID
				}
			}
		}(host, nodeID)
	}
	wg.Wait()
	return nodeIPs, ipToNode
}

// runLiveScans enriches the graph with observed TCP connections between known
// hosts, real interface networks, and the member nodes of each connected
// Kubernetes cluster. All scans run concurrently; each failure is appended to
// graph.Notes verbatim.
func runLiveScans(graph *TopologyGraph, servers []models.Server, ipToNode map[string]string, nodePort map[string]int, ifaceNets map[string][]*net.IPNet, scanTimes map[string]time.Time, selfIPs map[string][]net.IP) {
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	edgeSeen := map[string]bool{}
	for _, e := range graph.Edges {
		edgeSeen[e.Source+"|"+e.Target+"|"+e.Kind] = true
	}
	addEdge := func(e TopologyEdge) {
		mu.Lock()
		defer mu.Unlock()
		key := e.Source + "|" + e.Target + "|" + e.Kind
		revKey := e.Target + "|" + e.Source + "|" + e.Kind
		if edgeSeen[key] || (e.Kind == "network" && edgeSeen[revKey]) {
			return
		}
		edgeSeen[key] = true
		graph.Edges = append(graph.Edges, e)
	}
	addNote := func(format string, args ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		graph.Notes = append(graph.Notes, fmt.Sprintf(format, args...))
	}
	// A fresh read replaces whatever the cache had for that server.
	addIfaceNets := func(nodeID string, addrs []ifaceAddr) {
		mu.Lock()
		defer mu.Unlock()
		nets := make([]*net.IPNet, 0, len(addrs))
		ips := make([]net.IP, 0, len(addrs))
		for _, a := range addrs {
			nets = append(nets, a.Net)
			ips = append(ips, a.IP)
		}
		ifaceNets[nodeID] = nets
		selfIPs[nodeID] = ips
		scanTimes[nodeID] = time.Now()
	}

	for _, s := range servers {
		if s.Host != "" {
			wg.Add(1)
			go func(s models.Server) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				scanServer(s, ipToNode, nodePort, addEdge, addNote, addIfaceNets)
			}(s)
		}
		if s.IsK8s && s.K8sConnected && s.KubeConfig != "" {
			wg.Add(1)
			go func(s models.Server) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				scanClusterNodes(s, graph, &mu, addNote)
			}(s)
		}
	}
	wg.Wait()
}

func scanServer(s models.Server, ipToNode map[string]string, nodePort map[string]int, addEdge func(TopologyEdge), addNote func(string, ...interface{}), addIfaceNets func(string, []ifaceAddr)) {
	client, err := sshpool.GetOrCreate(s.ID, s.Host, s.Port, s.SSHUser, s.SSHKeyPath, s.SSHPassword, s.AuthType)
	if err != nil {
		addNote("%s: SSH connection failed: %v", s.Name, err)
		return
	}
	selfID := fmt.Sprintf("server-%d", s.ID)

	estabScript := linuxEstabScript
	ifaceScript := linuxIfaceNetScript
	switch s.OS {
	case "darwin":
		estabScript = darwinEstabScript
		ifaceScript = darwinIfaceNetScript
	case "windows":
		estabScript = windowsEstabScript
		ifaceScript = windowsIfaceNetScript
	}

	// ── Interface networks: which segments is this machine actually on? ──
	ifaceOut, _, err := client.RunCommandTimeout(ifaceScript, topologyScanTimeout)
	if err != nil {
		addNote("%s: interface scan failed: %v", s.Name, err)
	} else {
		addrs := parseIfaceNets(ifaceOut)
		addIfaceNets(selfID, addrs)
		// Persist so plain (non-live) loads keep showing the real segments.
		cidrs := make([]string, 0, len(addrs))
		for _, a := range addrs {
			cidrs = append(cidrs, a.Net.String())
		}
		if b, err := json.Marshal(cidrs); err == nil {
			if err := db.DB.Save(&models.NetworkScan{ServerID: s.ID, CIDRs: string(b), ScannedAt: time.Now()}).Error; err != nil {
				addNote("%s: caching interface scan failed: %v", s.Name, err)
			}
		}
	}

	// ── Established TCP connections to other known hosts ──
	out, _, err := client.RunCommandTimeout(estabScript, topologyScanTimeout)
	if err != nil {
		addNote("%s: connection scan failed: %v", s.Name, err)
		return
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		ip, port := splitRemoteAddr(strings.TrimSpace(line))
		if ip == "" {
			continue
		}
		target, known := ipToNode[ip]
		if !known || target == selfID {
			continue
		}
		// Skip the ephemeral (client) side of connections to a resource: only
		// the resource's own service port is meaningful on the map.
		if want, ok := nodePort[target]; ok && want != 0 && port != fmt.Sprintf("%d", want) {
			continue
		}
		label := ""
		if port != "" {
			label = "tcp :" + port
			if svc := describePort(":" + port); svc != "" {
				label = svc + " :" + port
			}
		}
		addEdge(TopologyEdge{Source: selfID, Target: target, Kind: "network", Label: label})
	}
}

func scanClusterNodes(s models.Server, graph *TopologyGraph, mu *sync.Mutex, addNote func(string, ...interface{})) {
	clientset, err := k8s.GetK8sClient(s.KubeConfig)
	if err != nil {
		addNote("%s: kubeconfig error: %v", s.Name, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	nodes, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		addNote("%s: listing cluster nodes failed: %v", s.Name, err)
		return
	}

	clusterID := fmt.Sprintf("server-%d", s.ID)
	for _, n := range nodes.Items {
		status := "offline"
		for _, cond := range n.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				status = "online"
			}
		}
		role := "worker"
		if _, ok := n.Labels["node-role.kubernetes.io/control-plane"]; ok {
			role = "control-plane"
		} else if _, ok := n.Labels["node-role.kubernetes.io/master"]; ok {
			role = "control-plane"
		}
		var addr string
		for _, a := range n.Status.Addresses {
			if a.Type == "InternalIP" {
				addr = a.Address
			}
		}
		nodeID := fmt.Sprintf("k8snode-%d-%s", s.ID, n.Name)
		mu.Lock()
		graph.Nodes = append(graph.Nodes, TopologyNode{
			ID:     nodeID,
			Kind:   "k8s_node",
			RefID:  s.ID,
			Host:   addr,
			Name:   n.Name,
			Status: status,
			Detail: role + " · " + n.Status.NodeInfo.KubeletVersion,
		})
		graph.Edges = append(graph.Edges, TopologyEdge{
			Source: clusterID, Target: nodeID, Kind: "member", Label: role,
		})
		mu.Unlock()
	}
}

// ── Network discovery (nmap) ──

const nmapScanTimeout = 45 * time.Second

// maxDiscoveryHosts caps how large a segment discovery will probe — an
// active ping sweep is intrusive and shouldn't silently balloon into
// scanning a /16. Anything bigger is skipped with a note explaining why.
const maxDiscoveryHosts = 1024

const nmapScript = `
if command -v nmap >/dev/null 2>&1; then
  nmap -sn -T4 --max-retries 1 %s 2>&1
else
  echo "__NMAP_NOT_FOUND__"
fi
`

// runNetworkDiscovery ping-sweeps each real (SSH-scanned) network segment
// from one server that sits on it, surfacing devices InfraEye doesn't manage
// — the rest of what's actually on the wire, not just what's registered.
// Only ever called on explicit ?discover=true opt-in.
func runNetworkDiscovery(graph *TopologyGraph, servers []models.Server, ifaceNets map[string][]*net.IPNet, ipToNode map[string]string, selfIPs map[string][]net.IP) {
	serverByNodeID := map[string]models.Server{}
	for _, s := range servers {
		serverByNodeID[fmt.Sprintf("server-%d", s.ID)] = s
	}

	// Known addresses: anything already represented on the map (declared
	// hosts, resolved DNS IPs, and every scanned server's own real IPs)
	// should never turn into a duplicate "discovered" node.
	known := map[string]bool{}
	for ipStr := range ipToNode {
		if net.ParseIP(ipStr) != nil {
			known[ipStr] = true
		}
	}
	for _, ips := range selfIPs {
		for _, ip := range ips {
			known[ip.String()] = true
		}
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	seenDiscovered := map[string]bool{}

	// One scan per unique real segment, run from the first server we find
	// that has an interface on it — scanning from every member would be
	// redundant (and, for a bridge/L2 network, give the same answer).
	scannedCIDR := map[string]bool{}
	for nodeID, nets := range ifaceNets {
		s, ok := serverByNodeID[nodeID]
		if !ok {
			continue
		}
		for _, n := range nets {
			masked := &net.IPNet{IP: n.IP.Mask(n.Mask), Mask: n.Mask}
			cidr := masked.String()
			mu.Lock()
			already := scannedCIDR[cidr]
			if !already {
				scannedCIDR[cidr] = true
			}
			mu.Unlock()
			if already {
				continue
			}

			ones, bits := masked.Mask.Size()
			if hostBits := bits - ones; hostBits > 0 && (1<<uint(hostBits)) > maxDiscoveryHosts {
				mu.Lock()
				graph.Notes = append(graph.Notes, fmt.Sprintf(
					"%s: %s is too large for a discovery scan (%d addresses) — skipping", s.Name, cidr, 1<<uint(hostBits)))
				mu.Unlock()
				continue
			}

			netID := "net-" + cidr
			wg.Add(1)
			go func(s models.Server, cidr, netID string) {
				defer wg.Done()
				discoverOnSegment(s, cidr, netID, known, graph, &mu, seenDiscovered)
			}(s, cidr, netID)
		}
	}
	wg.Wait()
}

func discoverOnSegment(s models.Server, cidr, netID string, known map[string]bool, graph *TopologyGraph, mu *sync.Mutex, seenDiscovered map[string]bool) {
	client, err := sshpool.GetOrCreate(s.ID, s.Host, s.Port, s.SSHUser, s.SSHKeyPath, s.SSHPassword, s.AuthType)
	if err != nil {
		mu.Lock()
		graph.Notes = append(graph.Notes, fmt.Sprintf("%s: SSH connection failed for discovery: %v", s.Name, err))
		mu.Unlock()
		return
	}
	out, _, err := client.RunCommandTimeout(fmt.Sprintf(nmapScript, cidr), nmapScanTimeout)
	if err != nil {
		mu.Lock()
		graph.Notes = append(graph.Notes, fmt.Sprintf("%s: nmap discovery on %s failed: %v", s.Name, cidr, err))
		mu.Unlock()
		return
	}
	if strings.Contains(out, "__NMAP_NOT_FOUND__") {
		mu.Lock()
		graph.Notes = append(graph.Notes, fmt.Sprintf("%s: nmap is not installed — skipping discovery on %s", s.Name, cidr))
		mu.Unlock()
		return
	}

	_, ipnet, _ := net.ParseCIDR(cidr)
	networkAddr := ipnet.IP.String()

	hosts := parseNmapHosts(out)
	selfID := fmt.Sprintf("server-%d", s.ID)
	mu.Lock()
	defer mu.Unlock()
	for _, h := range hosts {
		// The network address itself sometimes answers ARP on bridge
		// networks (an artifact of the bridge interface, not a real host).
		if known[h.IP] || h.IP == networkAddr {
			continue
		}
		nodeID := "discovered-" + strings.ReplaceAll(h.IP, ".", "-")
		if !seenDiscovered[nodeID] {
			seenDiscovered[nodeID] = true
			name := h.IP
			if h.Hostname != "" {
				name = h.Hostname
			}
			graph.Nodes = append(graph.Nodes, TopologyNode{
				ID: nodeID, Kind: "discovered", Name: name, Host: h.IP,
				Detail: h.MACVendor, Networks: []string{netID},
			})
		}
		label := "nmap"
		if h.MACVendor != "" {
			label = "nmap · " + h.MACVendor
		}
		graph.Edges = append(graph.Edges, TopologyEdge{
			Source: selfID, Target: nodeID, Kind: "discovered", Label: label,
		})
	}
}

type nmapHost struct {
	IP        string
	Hostname  string
	MACVendor string
}

// parseNmapHosts reads `nmap -sn` output: repeating blocks of
//
//	Nmap scan report for 172.30.10.11
//	Host is up (0.000060s latency).
//	MAC Address: 02:42:AC:1E:0A:0B (Unknown)
//
// (or "Nmap scan report for <hostname> (<ip>)" when reverse DNS resolves).
func parseNmapHosts(out string) []nmapHost {
	var hosts []nmapHost
	var cur *nmapHost
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Nmap scan report for "):
			rest := strings.TrimPrefix(line, "Nmap scan report for ")
			h := nmapHost{}
			if i := strings.LastIndex(rest, " ("); i >= 0 && strings.HasSuffix(rest, ")") {
				h.Hostname = rest[:i]
				h.IP = rest[i+2 : len(rest)-1]
			} else {
				h.IP = rest
			}
			if net.ParseIP(h.IP) == nil {
				continue
			}
			hosts = append(hosts, h)
			cur = &hosts[len(hosts)-1]
		case cur != nil && strings.HasPrefix(line, "MAC Address: "):
			rest := strings.TrimPrefix(line, "MAC Address: ")
			if i := strings.Index(rest, "("); i >= 0 && strings.HasSuffix(rest, ")") {
				cur.MACVendor = rest[i+1 : len(rest)-1]
			}
		}
	}
	return hosts
}

// ── Network segmentation ──

var cgnatNet = mustCIDR("100.64.0.0/10")

func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}

// buildNetworks derives the network segments and assigns every node its
// membership. Segments come exclusively from real interface CIDRs read off
// servers over SSH (live scan, or the cached result of the last one) — no
// guessed subnets. Addresses no scanned interface covers land in explicit
// unmapped/VPN/public/loopback buckets instead.
func buildNetworks(graph *TopologyGraph, nodeIPs map[string][]net.IP, ifaceNets map[string][]*net.IPNet, scanTimes map[string]time.Time) {
	nodeName := map[string]string{}
	for _, n := range graph.Nodes {
		nodeName[n.ID] = n.Name
	}

	// Deduplicate real segments across servers, remembering which servers
	// reported them and when the freshest reading was taken.
	type realNet struct {
		ipnet   *net.IPNet
		sources []string
		latest  time.Time
	}
	realNets := map[string]*realNet{}
	for nodeID, nets := range ifaceNets {
		for _, n := range nets {
			masked := &net.IPNet{IP: n.IP.Mask(n.Mask), Mask: n.Mask}
			key := masked.String()
			if realNets[key] == nil {
				realNets[key] = &realNet{ipnet: masked}
			}
			src := nodeName[nodeID]
			if src != "" && !slices.Contains(realNets[key].sources, src) {
				realNets[key].sources = append(realNets[key].sources, src)
			}
			if t := scanTimes[nodeID]; t.After(realNets[key].latest) {
				realNets[key].latest = t
			}
		}
	}

	networks := map[string]*TopologyNetwork{}
	addNetwork := func(nw TopologyNetwork) string {
		if existing, ok := networks[nw.ID]; ok {
			return existing.ID
		}
		networks[nw.ID] = &nw
		return nw.ID
	}

	realKeys := make([]string, 0, len(realNets))
	for key := range realNets {
		realKeys = append(realKeys, key)
	}
	sort.Strings(realKeys)
	for _, key := range realKeys {
		rn := realNets[key]
		source := "interfaces on " + strings.Join(rn.sources, ", ")
		if !rn.latest.IsZero() {
			source += " · scanned " + rn.latest.Local().Format("Jan 2 15:04")
		}
		addNetwork(TopologyNetwork{
			ID:     "net-" + key,
			CIDR:   key,
			Label:  key,
			Kind:   classifyIP(rn.ipnet.IP),
			Source: source,
		})
	}

	// networkFor buckets one address, creating the segment if it's new.
	networkFor := func(ip net.IP) string {
		for _, key := range realKeys {
			if realNets[key].ipnet.Contains(ip) {
				return "net-" + key
			}
		}
		switch {
		case ip.IsLoopback():
			return addNetwork(TopologyNetwork{ID: "net-loopback", CIDR: "127.0.0.0/8", Label: "loopback", Kind: "loopback"})
		case ip.To4() != nil && cgnatNet.Contains(ip):
			return addNetwork(TopologyNetwork{ID: "net-cgnat", CIDR: cgnatNet.String(), Label: "100.64.0.0/10 · CGNAT / VPN", Kind: "vpn"})
		case ip.IsPrivate():
			return addNetwork(TopologyNetwork{
				ID: "net-unmapped-private", CIDR: "", Label: "private · unmapped", Kind: "private",
				Source: "no scanned server interface covers these addresses — run a live scan",
			})
		default:
			return addNetwork(TopologyNetwork{ID: "net-public", CIDR: "0.0.0.0/0", Label: "public / internet", Kind: "public"})
		}
	}

	// Membership: real scanned interfaces are ground truth and go first (the
	// primary placement/color on the map), since the declared "host" a server
	// is reached at is often not where it actually sits — port-forwards,
	// jump hosts, NAT, and localhost-mapped test/container setups all mean
	// the SSH target address can differ from the machine's real network.
	// Declared/resolved addresses only fill in when no scan has run yet.
	for i := range graph.Nodes {
		node := &graph.Nodes[i]
		seen := map[string]bool{}
		add := func(id string) {
			if id != "" && !seen[id] {
				seen[id] = true
				node.Networks = append(node.Networks, id)
			}
		}
		for _, n := range ifaceNets[node.ID] {
			masked := &net.IPNet{IP: n.IP.Mask(n.Mask), Mask: n.Mask}
			add("net-" + masked.String())
		}
		if ip := net.ParseIP(node.Host); ip != nil {
			add(networkFor(ip))
		}
		for _, ip := range nodeIPs[node.ID] {
			add(networkFor(ip))
		}
	}

	// Stable ordering: real private segments first, then unmapped, VPN,
	// public, loopback — the same order the frontend lays zones out in.
	kindRank := map[string]int{"private": 0, "vpn": 1, "public": 2, "loopback": 3}
	list := make([]TopologyNetwork, 0, len(networks))
	for _, nw := range networks {
		list = append(list, *nw)
	}
	sort.Slice(list, func(i, j int) bool {
		ri, rj := kindRank[list[i].Kind], kindRank[list[j].Kind]
		if ri != rj {
			return ri < rj
		}
		iUnmapped := list[i].ID == "net-unmapped-private"
		jUnmapped := list[j].ID == "net-unmapped-private"
		if iUnmapped != jUnmapped {
			return jUnmapped
		}
		return list[i].CIDR < list[j].CIDR
	})
	graph.Networks = list
}

func classifyIP(ip net.IP) string {
	switch {
	case ip.IsLoopback():
		return "loopback"
	case cgnatNet.Contains(ip):
		return "vpn"
	case ip.IsPrivate():
		return "private"
	default:
		return "public"
	}
}

// parseIfaceNets reads interface-script output: "10.0.0.11/24" (linux,
// windows) or "10.0.0.11 0xffffff00" (macOS hex netmask).
// ifaceAddr is one scanned interface address: its exact IP (for identifying
// the scanning server itself in discovery results) plus the masked network
// it belongs to (the real, no-guessing subnet used for zoning the map).
type ifaceAddr struct {
	IP  net.IP
	Net *net.IPNet
}

func parseIfaceNets(out string) []ifaceAddr {
	addrs := []ifaceAddr{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ip net.IP
		var mask net.IPMask
		if strings.Contains(line, "/") {
			parsedIP, n, err := net.ParseCIDR(line)
			if err != nil || parsedIP.To4() == nil {
				continue
			}
			ip, mask = parsedIP, n.Mask
		} else if fields := strings.Fields(line); len(fields) == 2 {
			parsedIP := net.ParseIP(fields[0])
			var maskBits uint32
			if _, err := fmt.Sscanf(fields[1], "0x%x", &maskBits); err != nil || parsedIP == nil || parsedIP.To4() == nil {
				continue
			}
			ip = parsedIP
			mask = net.IPv4Mask(byte(maskBits>>24), byte(maskBits>>16), byte(maskBits>>8), byte(maskBits))
		} else {
			continue
		}
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() {
			continue
		}
		addrs = append(addrs, ifaceAddr{IP: ip, Net: &net.IPNet{IP: ip.Mask(mask), Mask: mask}})
	}
	return addrs
}

// splitRemoteAddr parses "10.0.0.5:5432", "[::1]:80", and the macOS netstat
// form "10.0.0.5.5432" into address and port.
func splitRemoteAddr(addr string) (string, string) {
	if addr == "" || addr == "*" {
		return "", ""
	}
	if host, port, err := net.SplitHostPort(addr); err == nil {
		return host, port
	}
	// macOS netstat separates the port with a dot.
	if i := strings.LastIndex(addr, "."); i > 0 && !strings.Contains(addr, ":") {
		return addr[:i], addr[i+1:]
	}
	return "", ""
}

func splitTags(tags string) []string {
	out := []string{}
	for _, t := range strings.Split(tags, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}
