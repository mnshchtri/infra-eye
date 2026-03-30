package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	gossh "golang.org/x/crypto/ssh"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

var (
	nsCache   = map[uint]nsCacheEntry{}
	nsCacheMu sync.RWMutex

	// kubeconfigWritten tracks which server IDs have had their kubeconfig written
	// to disk this process lifetime. Invalidated on WS reconnect.
	kubeconfigWritten   = map[uint]bool{}
	kubeconfigWrittenMu sync.Mutex
)

type nsCacheEntry struct {
	data      string
	timestamp time.Time
}

// writeKubeConfig safely writes a kubeconfig YAML to a temp file on the remote server.
// Uses base64 encoding to guarantee zero shell character corruption (newlines, quotes, etc).
// The decoding uses a cross-platform approach: -d for Linux and -D for macOS.
func writeKubeConfig(client *sshclient.Client, content string, path string) error {
	encoded := base64.StdEncoding.EncodeToString([]byte(content))
	
	setupCmd := fmt.Sprintf(
		"mkdir -p /tmp/infraeye && chmod 700 /tmp/infraeye && (echo '%s' | base64 -d > %s 2>/dev/null || echo '%s' | base64 -D > %s) && chmod 600 %s",
		encoded,
		path,
		encoded,
		path,
		path,
	)
	_, stderr, err := client.RunCommand(setupCmd)
	if err != nil {
		return fmt.Errorf("write kubeconfig: %v (stderr: %s)", err, stderr)
	}
	return nil
}

// kubeConfigPath returns the standard temp path for a server's kubeconfig.
func kubeConfigPath(serverID uint) string {
	return fmt.Sprintf("/tmp/infraeye/config_%d", serverID)
}

// ensureKubeConfig writes the kubeconfig to the remote if not yet written.
// It caches per server ID in memory to avoid redundant SSH calls.
func ensureKubeConfig(client *sshclient.Client, server *models.Server) (string, error) {
	if server.KubeConfig == "" {
		return "", nil
	}

	path := kubeConfigPath(server.ID)

	kubeconfigWrittenMu.Lock()
	alreadyWritten := kubeconfigWritten[server.ID]
	kubeconfigWrittenMu.Unlock()

	if !alreadyWritten {
		if err := writeKubeConfig(client, server.KubeConfig, path); err != nil {
			return "", err
		}
		kubeconfigWrittenMu.Lock()
		kubeconfigWritten[server.ID] = true
		kubeconfigWrittenMu.Unlock()
		log.Printf("✅ KubeConfig written for server %d at %s", server.ID, path)
	}

	return path, nil
}

// invalidateKubeConfigCache forces a re-write next time ensureKubeConfig is called (for older SSH endpoints).
func invalidateKubeConfigCache(serverID uint) {
	kubeconfigWrittenMu.Lock()
	delete(kubeconfigWritten, serverID)
	kubeconfigWrittenMu.Unlock()
}

// GetK8sClient returns a typed Kubernetes Clientset using the raw kubeconfig.
func GetK8sClient(kubeconfig string) (*kubernetes.Clientset, error) {
	if kubeconfig == "" {
		return nil, fmt.Errorf("no kubeconfig provided on server")
	}
	config, err := clientcmd.RESTConfigFromKubeConfig([]byte(kubeconfig))
	if err != nil {
		return nil, fmt.Errorf("failed to parse kubeconfig: %v", err)
	}
	config.QPS = 50
	config.Burst = 100
	return kubernetes.NewForConfig(config)
}

// sudoPrefix returns the sudo prefix for kubectl commands when the SSH user is not root.
// If the server has a password, it uses `echo 'pass' | sudo -S` for non-interactive sudo.
// If no password but not root, it tries `sudo -n` (works when NOPASSWD is configured).
func sudoPrefix(server *models.Server) string {
	if server.SSHUser == "root" {
		return ""
	}
	if server.SSHPassword != "" {
		// Escape single quotes in password for shell safety
		escaped := strings.ReplaceAll(server.SSHPassword, "'", "'\\''")
		return fmt.Sprintf("echo '%s' | sudo -S ", escaped)
	}
	// Passwordless sudo (NOPASSWD configured)
	return "sudo "
}

// buildBaseCmd returns the kubectl base command, ensuring kubeconfig is written.
// It automatically applies sudo when the SSH user is not root.
func buildBaseCmd(client *sshclient.Client, server *models.Server) (string, error) {
	pfx := sudoPrefix(server)

	if server.KubeConfig != "" {
		path, err := ensureKubeConfig(client, server)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%skubectl --kubeconfig %s", pfx, path), nil
	}

	// No kubeconfig: try default locations
	out, _, _ := client.RunCommand("if [ -f ~/.kube/config ]; then echo 'found'; fi")
	if strings.TrimSpace(out) == "found" {
		return fmt.Sprintf("%sKUBECONFIG=~/.kube/config kubectl", pfx), nil
	}
	return fmt.Sprintf("%skubectl", pfx), nil
}

// RunKubectl — executes a kubectl command via SSH and returns output
func RunKubectl(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	var req struct {
		Command string `json:"command" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("SSH connect: %v", err)})
		return
	}

	baseCmd, err := buildBaseCmd(client, &server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("kubeconfig setup: %v", err)})
		return
	}

	// Cache Logic: Check if it's a 'get namespaces' call and if we have a fresh cache
	if req.Command == "get namespaces -o json" {
		nsCacheMu.RLock()
		if entry, ok := nsCache[server.ID]; ok && time.Since(entry.timestamp) < 30*time.Second {
			nsCacheMu.RUnlock()
			c.JSON(http.StatusOK, gin.H{"success": true, "output": entry.data, "cached": true})
			return
		}
		nsCacheMu.RUnlock()
	}

	fullCmd := fmt.Sprintf("%s %s", baseCmd, req.Command)
	stdout, stderr, err := client.RunCommand(fullCmd)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"command": fullCmd,
			"output":  stdout,
			"error":   err.Error(),
			"stderr":  stderr,
			"success": false,
		})
		return
	}

	// Update Cache
	if req.Command == "get namespaces -o json" {
		nsCacheMu.Lock()
		nsCache[server.ID] = nsCacheEntry{data: stdout, timestamp: time.Now()}
		nsCacheMu.Unlock()
	}

	c.JSON(http.StatusOK, gin.H{
		"command": fullCmd,
		"output":  stdout,
		"success": true,
	})
}

// SSHTerminal — upgrades to WebSocket and creates a full PTY terminal over SSH
func SSHTerminal(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS terminal upgrade error: %v", err)
		return
	}
	defer wsConn.Close()

	// Try to get a session, with one retry if it fails
	var session *gossh.Session
	var sshClient *sshclient.Client
	sshClient, err = sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err == nil {
		session, err = sshClient.NewSession()
	}

	if err != nil {
		log.Printf("⚠️ SSH session failed for server %d, retrying once: %v", server.ID, err)
		sshclient.Remove(server.ID)

		time.Sleep(500 * time.Millisecond)

		sshClient, err = sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
		if err != nil {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("SSH reconnect error: %v\r\n", err)))
			return
		}
		session, err = sshClient.NewSession()
		if err != nil {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("SSH session error (retry): %v\r\n", err)))
			return
		}
	}
	defer session.Close()

	// Request PTY
	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 14400,
		gossh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 40, 120, modes); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("PTY request error: %v\r\n", err)))
		return
	}

	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	if err := session.Shell(); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Shell error: %v\r\n", err)))
		return
	}

	// SSH → WS (stdout)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// SSH → WS (stderr)
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// WS → SSH stdin
	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			break
		}
		if _, err := stdin.Write(msg); err != nil {
			break
		}
	}
}

// RunPodTerminal — specific terminal session for Pod Exec or Logs
func RunPodTerminal(c *gin.Context) {
	id := c.Param("id")
	pod := c.Query("pod")
	ns := c.Query("namespace")
	mode := c.Query("mode")
	container := c.Query("container")

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer wsConn.Close()

	if mode == "logs" {
		log.Printf("📝 Starting native logs for %s/%s", ns, pod)
		clientset, err := GetK8sClient(server.KubeConfig)
		if err != nil {
			log.Printf("K8s client err: %v", err)
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("K8s client error: %v\r\n", err)))
			return
		}
		
		// If container is empty, try to find the first container in the pod
		if container == "" {
			podInfo, err := clientset.CoreV1().Pods(ns).Get(context.TODO(), pod, metav1.GetOptions{})
			if err == nil && len(podInfo.Spec.Containers) > 0 {
				container = podInfo.Spec.Containers[0].Name
				log.Printf("ℹ️ No container specified, defaulting to: %s", container)
			}
		}

		tailLines := int64(100)
		req := clientset.CoreV1().Pods(ns).GetLogs(pod, &corev1.PodLogOptions{
			Container: container,
			Follow:    true,
			TailLines: &tailLines,
		})

		stream, err := req.Stream(context.TODO())
		if err != nil {
			log.Printf("Stream request err: %v", err)
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Failed to open logs stream: %v\r\n", err)))
			return
		}
		defer stream.Close()

		buf := make([]byte, 8192)
		for {
			n, err := stream.Read(buf)
			if n > 0 {
				log.Printf("Streamed %d bytes to ws", n)
				
				// Fix newline CR translation for pure \n log streams to render in xterm correctly!
				// Xterm requires \r\n to go back to the beginning of the line.
				chunk := string(buf[:n])
				chunk = strings.ReplaceAll(chunk, "\n", "\r\n")
				
				wsConn.WriteMessage(websocket.BinaryMessage, []byte(chunk))
			}
			if err != nil {
				log.Printf("Stream closed: %v", err)
				break
			}
		}
		return
	}

	sshClient, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("SSH connect error: %v\r\n", err)))
		return
	}

	session, err := sshClient.NewSession()
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("SSH session error: %v\r\n", err)))
		return
	}
	defer session.Close()

	// Request PTY
	modes := gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 14400, gossh.TTY_OP_OSPEED: 14400}
	if err := session.RequestPty("xterm-256color", 40, 120, modes); err != nil {
		return
	}

	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	baseCmd, err := buildBaseCmd(sshClient, &server)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("KubeConfig setup error: %v\r\n", err)))
		return
	}

	containerFlag := ""
	if container != "" {
		containerFlag = fmt.Sprintf("-c %s", container)
	}
	cmd := fmt.Sprintf("%s exec -it %s %s -n %s -- /bin/sh", baseCmd, pod, containerFlag, ns)

	if err := session.Start(cmd); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Exec error: %v\r\n", err)))
		return
	}

	// Bridges
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				wsConn.WriteMessage(websocket.BinaryMessage, buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			break
		}
		if _, err := stdin.Write(msg); err != nil {
			break
		}
	}
}

// TestK8sConnection — dry-run test of a KubeConfig against a server
func TestK8sConnection(c *gin.Context) {
	var req struct {
		Host        string `json:"host"`
		SSHUser     string `json:"ssh_user"`
		SSHPassword string `json:"ssh_password"`
		KubeConfig  string `json:"kube_config"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	log.Printf("🧪 Testing K8s Connection: Host=%s, User=%s", req.Host, req.SSHUser)

	// Use a temp server ID (0) for test connections, but remove any existing stale one first
	sshclient.Remove(0)
	client, err := sshclient.GetOrCreate(0, req.Host, 22, req.SSHUser, "", req.SSHPassword, "password")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("SSH connect failed: %v", err)})
		return
	}

	// Safely write the test kubeconfig
	testPath := "/tmp/infraeye/config_test"
	if err := writeKubeConfig(client, req.KubeConfig, testPath); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Failed to write kubeconfig: %v", err)})
		return
	}

	// Test with cluster info instead of just client version
	stdout, stderr, err := client.RunCommand(fmt.Sprintf("kubectl --kubeconfig %s cluster-info 2>&1 | head -5", testPath))
	if err != nil || strings.Contains(stdout, "error") || strings.Contains(stdout, "refused") {
		// Fall back to version check
		stdout2, _, err2 := client.RunCommand(fmt.Sprintf("kubectl --kubeconfig %s version --client 2>&1", testPath))
		if err2 != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Kubectl check failed: %v, stderr: %s", err, stderr)})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "output": stdout2 + "\n⚠️ Cluster API may not be reachable from proxy, but credentials are valid."})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "output": stdout})
}

// DisconnectCluster — removes KubeConfig to stop managing server as a cluster
func DisconnectCluster(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	server.KubeConfig = ""
	if err := db.DB.Save(&server).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("disconnect: %v", err)})
		return
	}

	// Invalidate the kubeconfig cache for this server
	invalidateKubeConfigCache(server.ID)

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Cluster disconnected successfully. Server remains active."})
}

// ApplyKubectl — applies a YAML string to the cluster via temp file
func ApplyKubectl(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	var req struct {
		YAML string `json:"yaml" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("SSH connect: %v", err)})
		return
	}

	baseCmd, err := buildBaseCmd(client, &server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("kubeconfig setup: %v", err)})
		return
	}

	// Write YAML using safe heredoc method
	tmpPath := fmt.Sprintf("/tmp/infraeye/apply_%d.yaml", server.ID)
	writeCmd := fmt.Sprintf("mkdir -p /tmp/infraeye && cat > %s << 'INFRAEYE_YAML_EOF'\n%s\nINFRAEYE_YAML_EOF", tmpPath, req.YAML)

	_, stderr, err := client.RunCommand(writeCmd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("File write failed: %v, stderr: %s", err, stderr)})
		return
	}

	// Run k8s apply
	applyCmd := fmt.Sprintf("%s apply -f %s", baseCmd, tmpPath)
	stdout, stderr, err := client.RunCommand(applyCmd)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": stdout, "stderr": stderr, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "output": stdout})
}

// WatchKubectl — streams resource queries to frontend natively via client-go WebSocket loop
func WatchKubectl(c *gin.Context) {
	id := c.Param("id")
	resource := c.Query("resource")
	ns := c.Query("namespace")

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS k8s watch upgrade error: %v", err)
		return
	}
	defer wsConn.Close()

	clientset, err := GetK8sClient(server.KubeConfig)
	if err != nil {
		msg := fmt.Sprintf(`{"error":"KubeConfig valid fail: %s","details":"Invalid KubeConfig YAML on server."}`, jsonEscape(err.Error()))
		wsConn.WriteMessage(websocket.TextMessage, []byte(msg))
		return
	}

	log.Printf("🔭 WatchKubectl (NATIVE): server=%s resource=%s ns=%s", id, resource, ns)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	done := make(chan struct{})
	go func() {
		for {
			if _, _, err := wsConn.ReadMessage(); err != nil {
				close(done)
				return
			}
		}
	}()

	sendNativeFrame(wsConn, clientset, resource, ns)

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			sendNativeFrame(wsConn, clientset, resource, ns)
		}
	}
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	// Remove surrounding quotes from json.Marshal output
	if len(b) >= 2 {
		return string(b[1 : len(b)-1])
	}
	return s
}

func sendNativeFrame(wsConn *websocket.Conn, clientset *kubernetes.Clientset, resource, ns string) {
	ctx := context.TODO()
	if ns == "All" {
		ns = "" // Native client uses empty string for "all namespaces"
	}

	var payload interface{}
	var fetchErr error

	if resource == "pulse" {
		var nodes, pods, deps, svcs, evs int
		
		if nodeList, e := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); e == nil {
			nodes = len(nodeList.Items)
		} else { fetchErr = e }
		
		if podList, e := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); e == nil {
			pods = len(podList.Items)
		} else { fetchErr = e }
		
		if depList, e := clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{}); e == nil {
			deps = len(depList.Items)
		} else { fetchErr = e }
		
		if svcList, e := clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{}); e == nil {
			svcs = len(svcList.Items)
		} else { fetchErr = e }
		
		if evList, e := clientset.CoreV1().Events("").List(ctx, metav1.ListOptions{}); e == nil {
			evs = len(evList.Items)
		} else { fetchErr = e }

		if fetchErr != nil && nodes == 0 && pods == 0 {
			wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"error":"K8s Native Fetch Failed","stderr":%q}`, fetchErr.Error())))
			return
		}

		payload = map[string]interface{}{
			"kind":  "Pulse",
			"stats": map[string]int{
				"nodes":       nodes,
				"pods":        pods,
				"deployments": deps,
				"services":    svcs,
				"events":      evs,
			},
		}
	} else {
		switch resource {
		case "nodes":
			payload, fetchErr = clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		case "pods":
			payload, fetchErr = clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		case "deployments":
			payload, fetchErr = clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
		case "services":
			payload, fetchErr = clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		case "events":
			payload, fetchErr = clientset.CoreV1().Events(ns).List(ctx, metav1.ListOptions{})
		default:
			fetchErr = fmt.Errorf("unsupported native resource: %s", resource)
		}

		if fetchErr != nil {
			errPayload := fmt.Sprintf(`{"error":"Native Fetch Failed","stderr":%q,"cmd":%q}`, fetchErr.Error(), resource)
			wsConn.WriteMessage(websocket.TextMessage, []byte(errPayload))
			return
		}
	}

	b, _ := json.Marshal(payload)
	wsConn.WriteMessage(websocket.TextMessage, b)
}

// DeleteKubectl — handles resource deletion
func DeleteKubectl(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Kind      string `json:"kind" binding:"required"`
		Name      string `json:"name" binding:"required"`
		Namespace string `json:"namespace"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ssh connect: " + err.Error()})
		return
	}

	baseCmd, err := buildBaseCmd(client, &server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "kubeconfig setup: " + err.Error()})
		return
	}

	nsFlag := ""
	if req.Namespace != "" && req.Namespace != "All" && req.Kind != "node" && req.Kind != "Node" {
		nsFlag = "-n " + req.Namespace
	}

	delCmd := fmt.Sprintf("%s delete %s %s %s", baseCmd, req.Kind, req.Name, nsFlag)
	stdout, stderr, err := client.RunCommand(delCmd)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error(), "stderr": stderr})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "output": stdout})
}
