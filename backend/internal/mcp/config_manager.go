package mcp

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
)

var (
	// Shared volume path — defaults to Docker path but can be overridden for local dev
	MasterConfigPath = "/shared_mcp/kubeconfig"
	// Host config path if mounted (inside Docker)
	HostConfigPath = "/kubeconfig_host"
	// Detected once at startup — controls whether kubeconfig addresses are patched
	runningInDocker bool
	// Set MCP_HOST_IPS=192.168.1.87,10.x.x.x to patch specific LAN IPs to host.docker.internal
	// when Docker containers can't route to them directly (e.g., OrbStack on macOS)
	mcpHostIPs map[string]bool
)

func init() {
	_, err := os.Stat("/.dockerenv")
	runningInDocker = (err == nil)

	// Parse MCP_HOST_IPS: comma-separated list of IPs that should be proxied
	// through host.docker.internal when the backend runs inside Docker.
	// Example: MCP_HOST_IPS=192.168.1.87,192.168.1.78
	mcpHostIPs = make(map[string]bool)
	if v := os.Getenv("MCP_HOST_IPS"); v != "" {
		for _, ip := range strings.Split(v, ",") {
			ip = strings.TrimSpace(ip)
			if ip != "" {
				mcpHostIPs[ip] = true
			}
		}
		log.Printf("🔧 MCP config: will proxy %v → host.docker.internal when in Docker", mcpHostIPs)
	}
	if path := os.Getenv("MCP_SHARED_PATH"); path != "" {
		MasterConfigPath = filepath.Join(path, "kubeconfig")
	} else if !runningInDocker {
		// Not in Docker: use project-relative path so the file lands in ./shared_mcp/
		cwd, _ := os.Getwd()
		for cwd != "/" {
			if _, err := os.Stat(filepath.Join(cwd, "backend", "go.mod")); err == nil {
				MasterConfigPath = filepath.Join(cwd, "shared_mcp", "kubeconfig")
				break
			}
			if _, err := os.Stat(filepath.Join(cwd, "go.mod")); err == nil {
				MasterConfigPath = filepath.Join(cwd, "..", "shared_mcp", "kubeconfig")
				break
			}
			cwd = filepath.Dir(cwd)
		}
	}
	log.Printf("🔧 MCP config: runningInDocker=%v  path=%s", runningInDocker, MasterConfigPath)
}

// SyncMasterKubeconfig merges all Kubernetes server configs from the database
// into a single master kubeconfig file for the MCP server.
func SyncMasterKubeconfig() error {
	var servers []models.Server
	if err := db.DB.Where("is_k8s = ? AND kube_config != ?", true, "").Find(&servers).Error; err != nil {
		return fmt.Errorf("failed to fetch k8s servers: %v", err)
	}

	masterConfig := api.NewConfig()

	// 1. Try to load host kubeconfig as default if it exists
	if _, err := os.Stat(HostConfigPath); err == nil {
		hostCfg, err := clientcmd.LoadFromFile(HostConfigPath)
		if err == nil {
			mergeConfigs(masterConfig, hostCfg, "default", nil)
		}
	}

	// 2. Merge all database clusters
	for _, srv := range servers {
		cfg, err := clientcmd.Load([]byte(srv.KubeConfig))
		if err != nil {
			log.Printf("⚠️  Skipping server %d (%s): invalid kubeconfig", srv.ID, srv.Name)
			continue
		}
		// Context name will be server-<id>
		prefix := fmt.Sprintf("server-%d", srv.ID)
		mergeConfigs(masterConfig, cfg, prefix, &srv)
	}

	// 3. Write to shared volume using a temporary file for atomicity
	dir := filepath.Dir(MasterConfigPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create shared directory: %v", err)
	}

	tempPath := MasterConfigPath + ".tmp"
	if err := clientcmd.WriteToFile(*masterConfig, tempPath); err != nil {
		return fmt.Errorf("failed to write temp master config: %v", err)
	}

	// Double check we have actual data before swapping
	if st, err := os.Stat(tempPath); err == nil && st.Size() > 0 {
		if err := os.Rename(tempPath, MasterConfigPath); err != nil {
			return fmt.Errorf("failed to move master config to final path: %v", err)
		}
	} else {
		return fmt.Errorf("master config write produced empty file")
	}

	absPath, _ := filepath.Abs(MasterConfigPath)
	log.Printf("🔄 MCP: Merged %d clusters into master kubeconfig at %s (abs: %s)", len(masterConfig.Clusters), MasterConfigPath, absPath)
	return nil
}

// mergeConfigs adds clusters, users, and contexts from src to dest with a prefix
func mergeConfigs(dest, src *api.Config, prefix string, srv *models.Server) {
	for name, cluster := range src.Clusters {
		uniqueName := fmt.Sprintf("%s-%s", prefix, name)
		patchedCluster := cluster.DeepCopy()
		originalServer := patchedCluster.Server

		// Extract the host part of the server URL
		serverURL := patchedCluster.Server
		hostWithPort := strings.TrimPrefix(strings.TrimPrefix(serverURL, "https://"), "http://")
		hostOnly := strings.Split(hostWithPort, ":")[0]

		// ── Address patching ─────────────────────────────────────────────────
		// 1. Loopback (127.0.0.1 / localhost): patch to host.docker.internal only
		//    when running in Docker (loopback inside a container ≠ the host machine).
		// 2. MCP_HOST_IPS: explicit set of LAN IPs unreachable from Docker network
		//    (e.g., OrbStack containers can't route to Mac's 192.168.x LAN IPs).
		//    Patch those to host.docker.internal so calls route through the Docker
		//    host gateway, which CAN reach those LAN addresses.
		isLoopback := hostOnly == "localhost" || hostOnly == "127.0.0.1"
		isHostIP := mcpHostIPs[hostOnly]

		if runningInDocker && (isLoopback || isHostIP) {
			patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, hostOnly, "host.docker.internal")
		}

		if originalServer != patchedCluster.Server {
			log.Printf("🔌 MCP Sync: Patched cluster [%s] %s → %s", uniqueName, originalServer, patchedCluster.Server)
		} else {
			log.Printf("🔌 MCP Sync: Cluster [%s] server %s (no patch, runningInDocker=%v)", uniqueName, originalServer, runningInDocker)
		}
		dest.Clusters[uniqueName] = patchedCluster
	}
	for name, authInfo := range src.AuthInfos {
		uniqueName := fmt.Sprintf("%s-%s", prefix, name)
		dest.AuthInfos[uniqueName] = authInfo.DeepCopy()
	}
	for name, context := range src.Contexts {
		uniqueName := fmt.Sprintf("%s-%s", prefix, name)
		// Ensure context points to prefixed cluster/user
		newCtx := context.DeepCopy()
		newCtx.Cluster = fmt.Sprintf("%s-%s", prefix, context.Cluster)
		newCtx.AuthInfo = fmt.Sprintf("%s-%s", prefix, context.AuthInfo)
		dest.Contexts[uniqueName] = newCtx
	}

	// Set a default context if none exists
	if dest.CurrentContext == "" && len(dest.Contexts) > 0 {
		for name := range dest.Contexts {
			dest.CurrentContext = name
			break
		}
	}
}

// EnsureSharedVolumePermissions ensures the shared directory is writable
func EnsureSharedVolumePermissions() {
	dir := filepath.Dir(MasterConfigPath)
	os.MkdirAll(dir, 0777)
	os.Chmod(dir, 0777)
}
