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

const (
	// Shared volume path inside the 'app' container
	MasterConfigPath = "/shared_mcp/kubeconfig"
	// Host config path if mounted
	HostConfigPath = "/kubeconfig_host"
)

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
			mergeConfigs(masterConfig, hostCfg, "default")
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
		mergeConfigs(masterConfig, cfg, prefix)
	}

	// 3. Write to shared volume
	dir := filepath.Dir(MasterConfigPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create shared directory: %v", err)
	}

	if err := clientcmd.WriteToFile(*masterConfig, MasterConfigPath); err != nil {
		return fmt.Errorf("failed to write master config: %v", err)
	}

	log.Printf("🔄 MCP: Merged %d clusters into master kubeconfig", len(servers))
	return nil
}

// mergeConfigs adds clusters, users, and contexts from src to dest with a prefix
func mergeConfigs(dest, src *api.Config, prefix string) {
	for name, cluster := range src.Clusters {
		uniqueName := fmt.Sprintf("%s-%s", prefix, name)
		// Patch for Docker-to-Host connectivity — Replace localhost/127.0.0.1 with host.docker.internal
		patchedCluster := cluster.DeepCopy()
		originalServer := patchedCluster.Server
		if strings.Contains(patchedCluster.Server, "localhost") {
			patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, "localhost", "host.docker.internal")
		}
		if strings.Contains(patchedCluster.Server, "127.0.0.1") {
			patchedCluster.Server = strings.ReplaceAll(patchedCluster.Server, "127.0.0.1", "host.docker.internal")
		}
		
		if originalServer != patchedCluster.Server {
			log.Printf("🔌 MCP: Patched cluster %s: %s -> %s", uniqueName, originalServer, patchedCluster.Server)
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
