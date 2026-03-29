package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	gossh "golang.org/x/crypto/ssh"
)

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

	output, err := client.RunCommand(fullCmd)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"command": fullCmd,
			"output":  output,
			"error":   err.Error(),
			"success": false,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"command": fullCmd,
		"output":  output,
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
