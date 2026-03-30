package handlers

import (
	"fmt"
	"log"
	"net/http"

	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

var (
	nsCache   = map[uint]nsCacheEntry{}
	nsCacheMu sync.RWMutex
)

type nsCacheEntry struct {
	data      string
	timestamp time.Time
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

	// Sanitise: always prefix with kubectl or use custom kubeconfig
	var fullCmd string
	if server.KubeConfig != "" {
		// Write kubeconfig to target temp if exists
		setupCmd := fmt.Sprintf("mkdir -p /tmp/infraeye && echo '%s' > /tmp/infraeye/config_%d", server.KubeConfig, server.ID)
		client.RunCommand(setupCmd)
		fullCmd = fmt.Sprintf("kubectl --kubeconfig /tmp/infraeye/config_%d %s", server.ID, req.Command)
	} else {
		fullCmd = "kubectl " + req.Command
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

	var cmd string
	if server.KubeConfig != "" {
		setupCmd := fmt.Sprintf("mkdir -p /tmp/infraeye && echo '%s' > /tmp/infraeye/config_%d", server.KubeConfig, server.ID)
		sshClient.RunCommand(setupCmd)
		
		if mode == "logs" {
			cmd = fmt.Sprintf("kubectl --kubeconfig /tmp/infraeye/config_%d logs -f %s -n %s --tail=100", server.ID, pod, ns)
		} else {
			cmd = fmt.Sprintf("kubectl --kubeconfig /tmp/infraeye/config_%d exec -it %s -n %s -- /bin/sh", server.ID, pod, ns)
		}
	} else {
		if mode == "logs" {
			cmd = fmt.Sprintf("kubectl logs -f %s -n %s --tail=100", pod, ns)
		} else {
			cmd = fmt.Sprintf("kubectl exec -it %s -n %s -- /bin/sh", pod, ns)
		}
	}

	if err := session.Start(cmd); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Exec error: %v\r\n", err)))
		return
	}

	// Bridges
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := stdout.Read(buf)
			if n > 0 { wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]) }
			if err != nil { return }
		}
	}()
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := stderr.Read(buf)
			if n > 0 { wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]) }
			if err != nil { return }
		}
	}()

	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil { break }
		if _, err := stdin.Write(msg); err != nil { break }
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

	// Use temporary SSH pool entry or just simple client
	client, err := sshclient.GetOrCreate(0, req.Host, 22, req.SSHUser, "", req.SSHPassword, "password")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("SSH connect failed: %v", err)})
		return
	}

	// Setup config temp
	setupCmd := fmt.Sprintf("mkdir -p /tmp/infraeye && echo '%s' > /tmp/infraeye/config_test", req.KubeConfig)
	client.RunCommand(setupCmd)

	// Test kubectl version
	stdout, stderr, err := client.RunCommand("kubectl --kubeconfig /tmp/infraeye/config_test version --client")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Kubectl failed: %v, stderr: %s", err, stderr)})
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

	// 1. Write YAML to remote temp file
	// We use a simple echo with single quotes. YAML might have single quotes, so we need some basic escaping.
	// But for simplicity, we'll try to just wrap it. 
	// Safer: write to a local temp, SCP it? Or just echo with a delimiter.
	content := req.YAML
	tmpPath := fmt.Sprintf("/tmp/infraeye/apply_%d.yaml", server.ID)
	setupCmd := fmt.Sprintf("mkdir -p /tmp/infraeye && cat << 'EOF' > %s\n%s\nEOF", tmpPath, content)
	
	_, stderr, err := client.RunCommand(setupCmd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("File write failed: %v, stderr: %s", err, stderr)})
		return
	}

	// 2. Run k8s apply
	var applyCmd string
	if server.KubeConfig != "" {
		applyCmd = fmt.Sprintf("kubectl --kubeconfig /tmp/infraeye/config_%d apply -f %s", server.ID, tmpPath)
	} else {
		applyCmd = fmt.Sprintf("kubectl apply -f %s", tmpPath)
	}

	stdout, stderr, err := client.RunCommand(applyCmd)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": stdout, "stderr": stderr, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "output": stdout})
}
