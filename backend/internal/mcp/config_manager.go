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
)

func init() {
	if path := os.Getenv("MCP_SHARED_PATH"); path != "" {
		MasterConfigPath = filepath.Join(path, "kubeconfig")
	} else if _, err := os.Stat("/.dockerenv"); err != nil {
		// Not in Docker: use project-relative path
		cwd, _ := os.Getwd()
		// Go up until we find the root where 'shared_mcp' should live
		for cwd != "/" {
			// In our repo structure, 'shared_mcp' lives next to 'backend/', 'frontend/', etc.
			if _, err := os.Stat(filepath.Join(cwd, "backend", "go.mod")); err == nil {
				MasterConfigPath = filepath.Join(cwd, "shared_mcp", "kubeconfig")
				break
			}
			// Fallback if we are already inside the 'backend' folder
			if _, err := os.Stat(filepath.Join(cwd, "go.mod")); err == nil {
				MasterConfigPath = filepath.Join(cwd, "..", "shared_mcp", "kubeconfig")
				break
			}
			cwd = filepath.Dir(cwd)
		}
	}
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
	// Determine the target host to replace 'localhost/127.0.0.1' with.
	// Defaults to host.docker.internal for local clusters, 
	// or the server's Host property for remote clusters.
	targetHost := "host.docker.internal"
	if srv != nil && srv.Host != "" && srv.Host != "localhost" && srv.Host != "127.0.0.1" {
		targetHost = srv.Host
	}

	for name, cluster := range src.Clusters {
		uniqueName := fmt.Sprintf("%s-%s", prefix, name)
		// Patch for Docker-to-Host connectivity
		patchedCluster := cluster.DeepCopy()
		originalServer := patchedCluster.Server
		
		// 1. Handle localhost/127.0.0.1
		patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, "localhost", targetHost)
		patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, "127.0.0.1", targetHost)
		
		// 2. Handle common LAN/Private IPs (likely the host machine or a remote machine we can reach by host)
		// We use a broader match to ensure any internal-facing IP is redirected to the gateway/target
		if strings.Contains(patchedCluster.Server, "192.168.") || 
		   strings.Contains(patchedCluster.Server, "10.") || 
		   strings.Contains(patchedCluster.Server, "172.16.") || 
		   strings.Contains(patchedCluster.Server, "172.17.") || 
		   strings.Contains(patchedCluster.Server, "172.18.") || 
		   strings.Contains(patchedCluster.Server, "172.19.") || 
		   strings.Contains(patchedCluster.Server, "172.2") || 
		   strings.Contains(patchedCluster.Server, "172.3") {
			
			// Remove protocol and split by port to isolate the host/IP
			hostWithPort := strings.TrimPrefix(strings.TrimPrefix(patchedCluster.Server, "https://"), "http://")
			hostOnly := strings.Split(hostWithPort, ":")[0]
			
			// Replace the specific IP with our target host
			patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, hostOnly, targetHost)
		}
		
		if originalServer != patchedCluster.Server {
			log.Printf("🔌 MCP Sync: Patched cluster [%s] %s -> %s", uniqueName, originalServer, patchedCluster.Server)
		} else {
			log.Printf("🔌 MCP Sync: Cluster [%s] server %s (NO PATCH NEEDED)", uniqueName, originalServer)
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
