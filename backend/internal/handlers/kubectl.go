package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	gossh "golang.org/x/crypto/ssh"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/tools/remotecommand"
	"k8s.io/client-go/transport/spdy"
	"sigs.k8s.io/yaml"
)

var (
	nsCache   = map[uint]nsCacheEntry{}
	nsCacheMu sync.RWMutex

	// kubeconfigWritten tracks which server IDs have had their kubeconfig written
	// to disk this process lifetime. Invalidated on WS reconnect.
	kubeconfigWritten   = map[uint]bool{}
	kubeconfigWrittenMu sync.Mutex

	portForwardSessions   = map[uint][]PortForwardSession{}
	portForwardSessionsMu sync.RWMutex

	// Track native Go routines for port forwarding
	nativePFCannels   = map[string]chan struct{}{}
	nativePFCannelsMu sync.Mutex
)

type nsCacheEntry struct {
	data      string
	timestamp time.Time
}

type PortForwardSession struct {
	ID         string `json:"id"`
	Target     string `json:"target"`
	Namespace  string `json:"namespace"`
	LocalPort  int    `json:"local_port"`
	RemotePort int    `json:"remote_port"`
	PID        string `json:"pid"`
	CreatedAt  string `json:"created_at"`
}

type wsStreamWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *wsStreamWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
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

	if alreadyWritten {
		// /tmp can be cleaned by reboot/tmpfiles; verify remote file still exists.
		checkCmd := fmt.Sprintf("if [ -f %s ]; then echo ok; fi", path)
		existsOut, _, checkErr := client.RunCommand(checkCmd)
		if checkErr != nil || strings.TrimSpace(existsOut) != "ok" {
			alreadyWritten = false
		}
	}

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

// getKubectlPath ensures we find the kubectl binary. Returns error if not found.
func getKubectlPath() (string, error) {
	path, err := exec.LookPath("kubectl")
	if err == nil {
		return path, nil
	}
	// Fallback for M1/M2 Mac Homebrew locations and Linux snap paths
	fallbacks := []string{
		"/opt/homebrew/bin/kubectl",
		"/usr/local/bin/kubectl",
		"/usr/bin/kubectl",
		"/snap/bin/kubectl",
		"/var/lib/snapd/snap/bin/kubectl",
	}
	for _, f := range fallbacks {
		if _, err := os.Stat(f); err == nil {
			log.Printf("🛠️ Found kubectl at fallback path: %s", f)
			return f, nil
		}
	}
	return "", fmt.Errorf("kubectl not found in PATH or standard backup locations. Please install kubectl on the backend host to manage clusters without SSH.")
}

// ensureLocalKubeConfig writes the kubeconfig to the local filesystem for direct-API clusters.
// This allows running kubectl commands locally on the backend server.
func ensureLocalKubeConfig(server *models.Server) (string, error) {
	if server.KubeConfig == "" {
		return "", fmt.Errorf("kubeconfig is empty")
	}

	dir := "/tmp/infraeye"
	os.MkdirAll(dir, 0700)
	path := fmt.Sprintf("%s/local_config_%d", dir, server.ID)

	err := os.WriteFile(path, []byte(server.KubeConfig), 0600)
	if err != nil {
		return "", fmt.Errorf("write local kubeconfig: %v", err)
	}

	return path, nil
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

	req.Command = strings.TrimSpace(req.Command)
	log.Printf("🛠️ RunKubectl: serverID=%v, command=%q", id, req.Command)

	if server.KubeConfig != "" {
		// Prefer local/native execution for Kubernetes commands if KubeConfig is available
		path, err := ensureLocalKubeConfig(&server)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": fmt.Sprintf("local kubeconfig setup failed: %v", err)})
			return
		}

		// Optimization: handle get namespaces natively if requested often
		if req.Command == "get namespaces -o json" {
			clientset, err := k8s.GetK8sClient(server.KubeConfig)
			if err == nil {
				nsList, err := clientset.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
				if err == nil {
					data, _ := json.Marshal(nsList)
					c.JSON(http.StatusOK, gin.H{"success": true, "output": string(data)})
					return
				}
			}
		}

		// Native YAML optimized reads for clusters without SSH
		cmdLower := strings.ToLower(req.Command)
		if strings.HasPrefix(cmdLower, "get ") && strings.HasSuffix(cmdLower, " -o yaml") {
			fields := strings.Fields(req.Command)
			var kind, name, ns string
			for i := 1; i < len(fields)-1; i++ {
				f := strings.ToLower(fields[i])
				if f == "-n" || f == "--namespace" {
					if i+1 < len(fields)-1 {
						ns = fields[i+1]
						i++
					}
				} else if kind == "" {
					kind = f
				} else if name == "" && !strings.HasPrefix(f, "-") {
					name = fields[i]
				}
			}

			if kind != "" && name != "" {
				log.Printf("🔹 Native YAML Fetch Triggered: kind=%q, name=%q, ns=%q", kind, name, ns)
				var output string
				var fErr error

				switch kind {
				case "pod", "pods", "po":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "pods", ns, name)
				case "node", "nodes", "no":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "nodes", "", name)
				case "deployment", "deployments", "deploy":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "apps", "v1", "deployments", ns, name)
				case "service", "services", "svc":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "services", ns, name)
				case "configmap", "configmaps", "cm":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "configmaps", ns, name)
				case "secret", "secrets":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "secrets", ns, name)
				case "ingress", "ingresses", "ing":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "networking.k8s.io", "v1", "ingresses", ns, name)
				case "pvc", "persistentvolumeclaims":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "persistentvolumeclaims", ns, name)
				case "pv", "persistentvolumes":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "persistentvolumes", "", name)
				case "daemonset", "daemonsets", "ds":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "apps", "v1", "daemonsets", ns, name)
				case "statefulset", "statefulsets", "sts":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "apps", "v1", "statefulsets", ns, name)
				case "replicaset", "replicasets", "rs":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "apps", "v1", "replicasets", ns, name)
				case "job", "jobs":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "batch", "v1", "jobs", ns, name)
				case "cronjob", "cronjobs", "cj":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "batch", "v1", "cronjobs", ns, name)
				case "sa", "serviceaccount", "serviceaccounts":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "", "v1", "serviceaccounts", ns, name)
				case "role", "roles":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "rbac.authorization.k8s.io", "v1", "roles", ns, name)
				case "clusterrole", "clusterroles":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "rbac.authorization.k8s.io", "v1", "clusterroles", "", name)
				case "rolebinding", "rolebindings":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "rbac.authorization.k8s.io", "v1", "rolebindings", ns, name)
				case "clusterrolebinding", "clusterrolebindings":
					output, fErr = k8s.GetNativeYaml(server.KubeConfig, "rbac.authorization.k8s.io", "v1", "clusterrolebindings", "", name)
				default:
					log.Printf("⚠️ Native YAML fetch not implemented for kind: %q. Falling back to CLI.", kind)
				}

				if fErr != nil {
					log.Printf("❌ Native YAML fetch failed for %s/%s: %v", kind, name, fErr)
				}

				if fErr == nil && output != "" {
					c.JSON(http.StatusOK, gin.H{"success": true, "output": output})
					return
				}
			} else {
				log.Printf("⚠️ Native YAML fetch failed to parse fields: %v", fields)
			}
		}

		// Generic kubectl execution
		bin, err := getKubectlPath()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
			return
		}
		args := append([]string{"--kubeconfig", path}, strings.Fields(req.Command)...)
		cmd := exec.Command(bin, args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"output":  string(out),
				"error":   err.Error(),
				"command": "kubectl " + strings.Join(args, " "),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "output": string(out)})
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

	if server.Host == "" {
		wsConn.WriteMessage(websocket.TextMessage, []byte("SSH Terminal is disabled for clusters without an SSH Proxy host.\r\n"))
		return
	}

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
		clientset, err := k8s.GetK8sClient(server.KubeConfig)
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

	restConfig, err := clientcmd.RESTConfigFromKubeConfig([]byte(server.KubeConfig))
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("KubeConfig parse error: %v\r\n", err)))
		return
	}
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("K8s client error: %v\r\n", err)))
		return
	}

	if container == "" {
		podInfo, err := clientset.CoreV1().Pods(ns).Get(context.TODO(), pod, metav1.GetOptions{})
		if err == nil && len(podInfo.Spec.Containers) > 0 {
			container = podInfo.Spec.Containers[0].Name
		}
	}

	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(pod).
		Namespace(ns).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   []string{"sh"},
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(restConfig, "POST", req.URL())
	if err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Exec setup error: %v\r\n", err)))
		return
	}

	stdinReader, stdinWriter := io.Pipe()
	defer stdinReader.Close()

	go func() {
		defer stdinWriter.Close()
		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				return
			}
			if _, err := stdinWriter.Write(msg); err != nil {
				return
			}
		}
	}()

	writer := &wsStreamWriter{conn: wsConn}
	if err := exec.StreamWithContext(context.TODO(), remotecommand.StreamOptions{
		Stdin:  stdinReader,
		Stdout: writer,
		Stderr: writer,
		Tty:    true,
	}); err != nil {
		wsConn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("Exec stream error: %v\r\n", err)))
		return
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

	// Case 1: Direct Connection (No SSH Proxy)
	if req.Host == "" {
		clientset, err := k8s.GetK8sClient(req.KubeConfig)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Invalid KubeConfig: %v", err)})
			return
		}
		// Verification call: Fetch server version
		ver, err := clientset.Discovery().ServerVersion()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Cluster API unreachable: %v\nNote: If this cluster is local, ensure your KubeConfig uses an IP reachable from this backend.", err)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"output":  fmt.Sprintf("✅ Connected directly to Cluster API.\nKubernetes Version: %s\nPlatform: %s", ver.GitVersion, ver.Platform),
		})
		return
	}

	// Case 2: SSH Proxy Connection
	// Use a temp server ID (0) for test connections, but remove any existing stale one first
	sshclient.Remove(0)
	client, err := sshclient.GetOrCreate(0, req.Host, 22, req.SSHUser, "", req.SSHPassword, "password")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("SSH proxy connect failed: %v", err)})
		return
	}

	// Safely write the test kubeconfig
	testPath := "/tmp/infraeye/config_test"
	if err := writeKubeConfig(client, req.KubeConfig, testPath); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "output": fmt.Sprintf("Failed to write kubeconfig to proxy: %v", err)})
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

// DisconnectCluster — marks cluster as disconnected but retains kubeconfig
func DisconnectCluster(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	server.K8sConnected = false
	if err := db.DB.Save(&server).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("disconnect: %v", err)})
		return
	}

	// Invalidate the kubeconfig cache for this server
	invalidateKubeConfigCache(server.ID)

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Cluster disconnected successfully. State preserved."})
}

// ReconnectCluster — sets K8sConnected to true
func ReconnectCluster(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	server.K8sConnected = true
	if err := db.DB.Save(&server).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("reconnect: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Cluster reconnected successfully."})
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
	if server.KubeConfig != "" {
		// Generic Dynamic Apply (Server-Side Apply)
		// This handles ANY resource type, including CRDs.
		var unstructuredObj map[string]interface{}
		if err := yaml.Unmarshal([]byte(req.YAML), &unstructuredObj); err == nil {
			apiVersion, _ := unstructuredObj["apiVersion"].(string)
			kind, _ := unstructuredObj["kind"].(string)
			metadata, _ := unstructuredObj["metadata"].(map[string]interface{})
			name, _ := metadata["name"].(string)
			namespace, _ := metadata["namespace"].(string)

			if apiVersion != "" && kind != "" && name != "" {
				log.Printf("🔹 Native Dynamic Apply Triggered: %s %s/%s", kind, namespace, name)

				// Use Dynamic Client
				dClient, err := k8s.GetDynamicClient(server.KubeConfig)
				if err == nil {
					// Parse Group/Version
					parts := strings.Split(apiVersion, "/")
					var group, version string
					if len(parts) == 2 {
						group = parts[0]
						version = parts[1]
					} else {
						version = parts[0]
					}

					// Map Kind to Resource (pluralize)
					resource := strings.ToLower(kind) + "s"
					if strings.HasSuffix(resource, "ys") {
						resource = resource[:len(resource)-2] + "ies"
					}
					if kind == "Ingress" {
						resource = "ingresses"
					}
					if kind == "StorageClass" {
						resource = "storageclasses"
					}

					gvr := schema.GroupVersionResource{
						Group:    group,
						Version:  version,
						Resource: resource,
					}

					jsonBytes, _ := json.Marshal(unstructuredObj)
					var applyErr error
					ctx := context.Background()
					force := true
					patchOpts := metav1.PatchOptions{
						FieldManager: "infraeye-ui",
						Force:        &force,
					}

					if namespace != "" {
						_, applyErr = dClient.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.ApplyPatchType, jsonBytes, patchOpts)
					} else {
						_, applyErr = dClient.Resource(gvr).Patch(ctx, name, types.ApplyPatchType, jsonBytes, patchOpts)
					}

					if applyErr == nil {
						c.JSON(http.StatusOK, gin.H{"success": true, "output": fmt.Sprintf("✅ %s '%s' applied successfully (Native SSA)", kind, name)})
						return
					}
					log.Printf("❌ Native SSA failed for %s %s: %v. Falling back to CLI.", kind, name, applyErr)
					goto CLI_FALLBACK
				}
				log.Printf("⚠️ Dynamic Client setup failed. Falling back to CLI.")
				goto CLI_FALLBACK
			}
			log.Printf("⚠️ YAML missing required fields for native apply. Falling back to CLI.")
			goto CLI_FALLBACK
		}

	CLI_FALLBACK:
		// Use local kubectl apply for direct API clusters
		path, err := ensureLocalKubeConfig(&server)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": fmt.Sprintf("local kubeconfig setup failed: %v", err)})
			return
		}

		bin, err := getKubectlPath()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
			return
		}
		cmd := exec.Command(bin, "--kubeconfig", path, "apply", "-f", "-")
		cmd.Stdin = strings.NewReader(req.YAML)
		out, err := cmd.CombinedOutput()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"output":  string(out),
				"error":   err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true, "output": string(out)})
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

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		log.Printf("❌ WatchKubectl Auth Error: %v", err)
		msg := fmt.Sprintf(`{"error":"KubeConfig valid fail", "details":"Parse Error: %s"}`, jsonEscape(err.Error()))
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

	sendNativeFrame(wsConn, server, clientset, resource, ns)

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			sendNativeFrame(wsConn, server, clientset, resource, ns)
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

func sendNativeFrame(wsConn *websocket.Conn, server models.Server, clientset *kubernetes.Clientset, resource, ns string) {
	ctx := context.TODO()
	if ns == "All" {
		ns = "" // Native client uses empty string for "all namespaces"
	}

	var payload interface{}
	var fetchErr error

	if resource == "pulse" {
		var nodes, nodesReady int
		var pods, podsRunning int
		var deps, depsReady int
		var rss, rssReady int
		var dss, dssReady int
		var stss, stssReady int
		var jobs, cjs int
		var svcs, eps, ings int
		var cms, secs, pvs, scs int

		var cpuTotal, cpuAllocatable, cpuUsage int64    // millicores
		var memTotal, memAllocatable, memUsage int64    // bytes
		var diskTotal, diskAllocatable, diskUsage int64 // bytes

		errs := make(map[string]string)

		// Helper to capture errors
		capture := func(key string, err error) {
			if err != nil {
				errs[key] = err.Error()
			}
		}

		// Nodes (cluster-scoped - always use empty string)
		nl, nlErr := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		capture("nodes", nlErr)
		if nlErr == nil {
			nodes = len(nl.Items)
			for _, n := range nl.Items {
				cpuTotal += n.Status.Capacity.Cpu().MilliValue()
				cpuAllocatable += n.Status.Allocatable.Cpu().MilliValue()
				memTotal += n.Status.Capacity.Memory().Value()
				memAllocatable += n.Status.Allocatable.Memory().Value()
				diskTotal += n.Status.Capacity.StorageEphemeral().Value()
				diskAllocatable += n.Status.Allocatable.StorageEphemeral().Value()

				for _, c := range n.Status.Conditions {
					log.Printf("[PULSE DEBUG] Node=%s Condition.Type=%q Condition.Status=%q", n.Name, c.Type, c.Status)
					if strings.EqualFold(string(c.Type), "Ready") && strings.EqualFold(string(c.Status), "True") {
						nodesReady++
						break
					}
				}
			}
		} else {
			log.Printf("[PULSE DEBUG] Nodes list error: %v", nlErr)
		}

		// Workloads
		pl, plErr := clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		capture("pods", plErr)
		if plErr == nil {
			pods = len(pl.Items)
			for _, p := range pl.Items {
				isReady := false
				for _, c := range p.Status.Conditions {
					if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
						isReady = true
						break
					}
				}
				if isReady {
					podsRunning++
				}
			}
			log.Printf("[PULSE DEBUG] Pods: total=%d ready=%d ns=%q", pods, podsRunning, ns)
		} else {
			log.Printf("[PULSE DEBUG] Pods list error: %v", plErr)
		}

		dl, dlErr := clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
		capture("deployments", dlErr)
		if dlErr == nil {
			deps = len(dl.Items)
			for _, d := range dl.Items {
				desired := int32(1)
				if d.Spec.Replicas != nil {
					desired = *d.Spec.Replicas
				}
				log.Printf("[PULSE DEBUG] Deploy=%s desired=%d available=%d ready=%d", d.Name, desired, d.Status.AvailableReplicas, d.Status.ReadyReplicas)
				if desired == 0 {
					depsReady++
				} else if d.Status.ReadyReplicas >= desired {
					depsReady++
				}
			}
			log.Printf("[PULSE DEBUG] Deployments: total=%d ready=%d", deps, depsReady)
		}

		rl, rlErr := clientset.AppsV1().ReplicaSets(ns).List(ctx, metav1.ListOptions{})
		capture("replicasets", rlErr)
		if rlErr == nil {
			rss = len(rl.Items)
			for _, r := range rl.Items {
				desired := int32(1)
				if r.Spec.Replicas != nil {
					desired = *r.Spec.Replicas
				}
				if desired == 0 || r.Status.ReadyReplicas >= desired {
					rssReady++
				}
			}
		}

		sl, slErr := clientset.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
		capture("statefulsets", slErr)
		if slErr == nil {
			stss = len(sl.Items)
			for _, s := range sl.Items {
				desired := int32(1)
				if s.Spec.Replicas != nil {
					desired = *s.Spec.Replicas
				}
				if desired == 0 || s.Status.ReadyReplicas >= desired {
					stssReady++
				}
			}
		}

		dsl, dslErr := clientset.AppsV1().DaemonSets(ns).List(ctx, metav1.ListOptions{})
		capture("daemonsets", dslErr)
		if dslErr == nil {
			dss = len(dsl.Items)
			for _, d := range dsl.Items {
				if d.Status.DesiredNumberScheduled == 0 || d.Status.NumberReady >= d.Status.DesiredNumberScheduled {
					dssReady++
				}
			}
		}

		jl, jlErr := clientset.BatchV1().Jobs(ns).List(ctx, metav1.ListOptions{})
		capture("jobs", jlErr)
		if jlErr == nil {
			jobs = len(jl.Items)
		}

		cjl, cjlErr := clientset.BatchV1().CronJobs(ns).List(ctx, metav1.ListOptions{})
		capture("cronjobs", cjlErr)
		if cjlErr == nil {
			cjs = len(cjl.Items)
		}

		// Network
		svcl, svcErr := clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		capture("services", svcErr)
		if svcErr == nil {
			svcs = len(svcl.Items)
		}

		epl, epErr := clientset.CoreV1().Endpoints(ns).List(ctx, metav1.ListOptions{})
		capture("endpoints", epErr)
		if epErr == nil {
			eps = len(epl.Items)
		}

		ingl, ingErr := clientset.NetworkingV1().Ingresses(ns).List(ctx, metav1.ListOptions{})
		capture("ingresses", ingErr)
		if ingErr == nil {
			ings = len(ingl.Items)
		}

		// Configuration & Storage
		cml, cmErr := clientset.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
		capture("configmaps", cmErr)
		if cmErr == nil {
			cms = len(cml.Items)
		}

		secl, secErr := clientset.CoreV1().Secrets(ns).List(ctx, metav1.ListOptions{})
		capture("secrets", secErr)
		if secErr == nil {
			secs = len(secl.Items)
		}

		pvl, pvErr := clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
		capture("pvs", pvErr)
		if pvErr == nil {
			pvs = len(pvl.Items)
		}

		pvcl, pvcErr := clientset.CoreV1().PersistentVolumeClaims(ns).List(ctx, metav1.ListOptions{})
		capture("pvcs", pvcErr)
		var pvcs int
		if pvcErr == nil {
			pvcs = len(pvcl.Items)
		}

		scl, scErr := clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
		capture("storageclasses", scErr)
		if scErr == nil {
			scs = len(scl.Items)
		}

		rql, rqErr := clientset.CoreV1().ResourceQuotas(ns).List(ctx, metav1.ListOptions{})
		capture("resourcequotas", rqErr)
		var rqs int
		if rqErr == nil {
			rqs = len(rql.Items)
		}

		hpal, hpaErr := clientset.AutoscalingV1().HorizontalPodAutoscalers(ns).List(ctx, metav1.ListOptions{})
		capture("hpa", hpaErr)
		var hpas int
		if hpaErr == nil {
			hpas = len(hpal.Items)
		}

		// Fetch real-time usage from metrics-server
		nodeMetrics, nmErr := k8s.GetNodeMetrics(server.KubeConfig)
		if nmErr == nil && nodeMetrics != nil {
			for _, nm := range nodeMetrics.Items {
				cpuUsage += nm.Usage.Cpu().MilliValue()
				memUsage += nm.Usage.Memory().Value()
			}
		} else {
			// Fallback: use (Total - Allocatable) as estimated usage if metrics-server is missing
			cpuUsage = cpuTotal - cpuAllocatable
			memUsage = memTotal - memAllocatable
		}
		// Disk usage fallback (0.05% factor)
		diskUsage = int64(float64(diskTotal) * 0.05)

		payload = map[string]interface{}{
			"kind": "Pulse",
			"stats": map[string]interface{}{
				"nodes":             nodes,
				"nodesReady":        nodesReady,
				"pods":              pods,
				"podsRunning":       podsRunning,
				"deployments":       deps,
				"deploymentsReady":  depsReady,
				"replicasets":       rss,
				"replicasetsReady":  rssReady,
				"statefulsets":      stss,
				"statefulsetsReady": stssReady,
				"daemonsets":        dss,
				"daemonsetsReady":   dssReady,
				"jobs":              jobs,
				"cronjobs":          cjs,
				"services":          svcs,
				"endpoints":         eps,
				"ingresses":         ings,
				"configmaps":        cms,
				"secrets":           secs,
				"pvs":               pvs,
				"pvcs":              pvcs,
				"storageclasses":    scs,
				"resourcequotas":    rqs,
				"hpa":               hpas,
				"cpuTotal":          cpuTotal,
				"cpuAllocatable":    cpuAllocatable,
				"cpuUsage":          cpuUsage,
				"memTotal":          memTotal,
				"memAllocatable":    memAllocatable,
				"memUsage":          memUsage,
				"diskTotal":         diskTotal,
				"diskAllocatable":   diskAllocatable,
				"diskUsage":         diskUsage,
			},
			"errors": errs,
		}
	} else {
		switch resource {
		case "nodes":
			payload, fetchErr = clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
		case "pods":
			payload, fetchErr = clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		case "deployments":
			payload, fetchErr = clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
		case "daemonsets":
			payload, fetchErr = clientset.AppsV1().DaemonSets(ns).List(ctx, metav1.ListOptions{})
		case "statefulsets":
			payload, fetchErr = clientset.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
		case "replicasets":
			payload, fetchErr = clientset.AppsV1().ReplicaSets(ns).List(ctx, metav1.ListOptions{})
		case "jobs":
			payload, fetchErr = clientset.BatchV1().Jobs(ns).List(ctx, metav1.ListOptions{})
		case "cronjobs":
			payload, fetchErr = clientset.BatchV1().CronJobs(ns).List(ctx, metav1.ListOptions{})
		case "configmaps":
			payload, fetchErr = clientset.CoreV1().ConfigMaps(ns).List(ctx, metav1.ListOptions{})
		case "secrets":
			payload, fetchErr = clientset.CoreV1().Secrets(ns).List(ctx, metav1.ListOptions{})
		case "resourcequotas":
			payload, fetchErr = clientset.CoreV1().ResourceQuotas(ns).List(ctx, metav1.ListOptions{})
		case "hpa":
			payload, fetchErr = clientset.AutoscalingV1().HorizontalPodAutoscalers(ns).List(ctx, metav1.ListOptions{})
		case "services":
			payload, fetchErr = clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		case "endpoints":
			payload, fetchErr = clientset.CoreV1().Endpoints(ns).List(ctx, metav1.ListOptions{})
		case "ingresses":
			payload, fetchErr = clientset.NetworkingV1().Ingresses(ns).List(ctx, metav1.ListOptions{})
		case "networkpolicies":
			payload, fetchErr = clientset.NetworkingV1().NetworkPolicies(ns).List(ctx, metav1.ListOptions{})
		case "pvcs":
			payload, fetchErr = clientset.CoreV1().PersistentVolumeClaims(ns).List(ctx, metav1.ListOptions{})
		case "pvs":
			payload, fetchErr = clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
		case "storageclasses":
			payload, fetchErr = clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
		case "serviceaccounts":
			payload, fetchErr = clientset.CoreV1().ServiceAccounts(ns).List(ctx, metav1.ListOptions{})
		case "roles":
			payload, fetchErr = clientset.RbacV1().Roles(ns).List(ctx, metav1.ListOptions{})
		case "clusterroles":
			payload, fetchErr = clientset.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
		case "rolebindings":
			payload, fetchErr = clientset.RbacV1().RoleBindings(ns).List(ctx, metav1.ListOptions{})
		case "clusterrolebindings":
			payload, fetchErr = clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
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

	// --- Native delete for clusters with KubeConfig ---
	if server.KubeConfig != "" {
		dClient, err := k8s.GetDynamicClient(server.KubeConfig)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "dynamic client: " + err.Error()})
			return
		}

		// Map Kind → GVR
		type gvrEntry struct{ group, version, resource string }
		kindToGVR := map[string]gvrEntry{
			"Pod": {"", "v1", "pods"}, "Node": {"", "v1", "nodes"},
			"Namespace": {"", "v1", "namespaces"}, "Service": {"", "v1", "services"},
			"Endpoints": {"", "v1", "endpoints"}, "ConfigMap": {"", "v1", "configmaps"},
			"Secret": {"", "v1", "secrets"}, "ServiceAccount": {"", "v1", "serviceaccounts"},
			"PersistentVolume":      {"", "v1", "persistentvolumes"},
			"PersistentVolumeClaim": {"", "v1", "persistentvolumeclaims"},
			"ResourceQuota":         {"", "v1", "resourcequotas"},
			"Deployment":            {"apps", "v1", "deployments"}, "ReplicaSet": {"apps", "v1", "replicasets"},
			"StatefulSet": {"apps", "v1", "statefulsets"}, "DaemonSet": {"apps", "v1", "daemonsets"},
			"Job": {"batch", "v1", "jobs"}, "CronJob": {"batch", "v1", "cronjobs"},
			"Ingress":                 {"networking.k8s.io", "v1", "ingresses"},
			"NetworkPolicy":           {"networking.k8s.io", "v1", "networkpolicies"},
			"StorageClass":            {"storage.k8s.io", "v1", "storageclasses"},
			"Role":                    {"rbac.authorization.k8s.io", "v1", "roles"},
			"ClusterRole":             {"rbac.authorization.k8s.io", "v1", "clusterroles"},
			"RoleBinding":             {"rbac.authorization.k8s.io", "v1", "rolebindings"},
			"ClusterRoleBinding":      {"rbac.authorization.k8s.io", "v1", "clusterrolebindings"},
			"HorizontalPodAutoscaler": {"autoscaling", "v1", "horizontalpodautoscalers"},
			"Event":                   {"", "v1", "events"},
		}

		// Normalize kind (Title-case)
		kind := req.Kind
		if len(kind) > 0 {
			kind = strings.ToUpper(kind[:1]) + strings.ToLower(kind[1:])
		}
		entry, ok := kindToGVR[kind]
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported resource kind for native delete: " + kind})
			return
		}

		gvr := schema.GroupVersionResource{Group: entry.group, Version: entry.version, Resource: entry.resource}
		ctx := context.Background()
		var delErr error
		if req.Namespace != "" {
			delErr = dClient.Resource(gvr).Namespace(req.Namespace).Delete(ctx, req.Name, metav1.DeleteOptions{})
		} else {
			delErr = dClient.Resource(gvr).Delete(ctx, req.Name, metav1.DeleteOptions{})
		}
		if delErr != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": delErr.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "output": fmt.Sprintf("%s '%s' deleted", kind, req.Name)})
		return
	}

	// --- SSH-backed clusters ---
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

// StartPortForward starts a background native Go port-forward session.
func StartPortForward(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Namespace  string `json:"namespace" binding:"required"`
		Target     string `json:"target" binding:"required"` // e.g. svc/my-service or pod/my-pod
		LocalPort  int    `json:"local_port" binding:"required"`
		RemotePort int    `json:"remote_port" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.LocalPort <= 0 || req.RemotePort <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ports must be positive integers"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// 1. Setup K8s Client & Config
	restConfig, err := k8s.GetRestConfig(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "kubeconfig parse error: " + err.Error()})
		return
	}
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "k8s client error: " + err.Error()})
		return
	}

	// 2. Resolve target to a specific POD name
	// target can be "pod/name" or "svc/name" or "deployment/name"
	targetParts := strings.Split(req.Target, "/")
	var podName string
	targetKind := "pod"
	targetName := req.Target
	if len(targetParts) == 2 {
		targetKind = strings.ToLower(targetParts[0])
		targetName = targetParts[1]
	}

	switch targetKind {
	case "pod", "po":
		podName = targetName
	case "svc", "service":
		svc, err := clientset.CoreV1().Services(req.Namespace).Get(context.TODO(), targetName, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "service not found: " + err.Error()})
			return
		}
		selector := ""
		for k, v := range svc.Spec.Selector {
			if selector != "" {
				selector += ","
			}
			selector += k + "=" + v
		}
		pods, err := clientset.CoreV1().Pods(req.Namespace).List(context.TODO(), metav1.ListOptions{LabelSelector: selector})
		if err != nil || len(pods.Items) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "no pods found for service selector"})
			return
		}
		podName = pods.Items[0].Name
	case "deploy", "deployment":
		deploy, err := clientset.AppsV1().Deployments(req.Namespace).Get(context.TODO(), targetName, metav1.GetOptions{})
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "deployment not found: " + err.Error()})
			return
		}
		selector, _ := metav1.LabelSelectorAsSelector(deploy.Spec.Selector)
		pods, err := clientset.CoreV1().Pods(req.Namespace).List(context.TODO(), metav1.ListOptions{LabelSelector: selector.String()})
		if err != nil || len(pods.Items) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "no pods found for deployment selector"})
			return
		}
		podName = pods.Items[0].Name
	default:
		podName = targetName // Fallback to raw string as pod name
	}

	// 3. Setup Port Forwarding Dialer
	roundTripper, upgrader, err := spdy.RoundTripperFor(restConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "spdy setup error: " + err.Error()})
		return
	}

	pfURL := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Namespace(req.Namespace).
		Name(podName).
		SubResource("portforward").URL()

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: roundTripper}, "POST", pfURL)

	// 4. Run Port Forwarding in background
	stopChan := make(chan struct{}, 1)
	readyChan := make(chan struct{})

	sessionID := fmt.Sprintf("native-pf-%d", time.Now().UnixNano())

	pf, err := portforward.NewOnAddresses(dialer, []string{"0.0.0.0"}, []string{fmt.Sprintf("%d:%d", req.LocalPort, req.RemotePort)}, stopChan, readyChan, io.Discard, io.Discard)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pf initialization failed: " + err.Error()})
		return
	}

	go func() {
		if err := pf.ForwardPorts(); err != nil {
			log.Printf("❌ Native PortForward failed for %s: %v", sessionID, err)
		}
	}()

	// Wait for readiness or timeout
	select {
	case <-readyChan:
		log.Printf("✅ Native PortForward ready: %s (%d:%d)", sessionID, req.LocalPort, req.RemotePort)
	case <-time.After(10 * time.Second):
		close(stopChan)
		c.JSON(http.StatusRequestTimeout, gin.H{"error": "port-forward readiness timeout"})
		return
	}

	// 5. Track Session
	nativePFCannelsMu.Lock()
	nativePFCannels[sessionID] = stopChan
	nativePFCannelsMu.Unlock()

	entry := PortForwardSession{
		ID:         sessionID,
		Namespace:  req.Namespace,
		Target:     req.Target,
		LocalPort:  req.LocalPort,
		RemotePort: req.RemotePort,
		PID:        "native",
		CreatedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	portForwardSessionsMu.Lock()
	portForwardSessions[server.ID] = append(portForwardSessions[server.ID], entry)
	portForwardSessionsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"success": true, "session": entry})
}

// ListPortForwards returns tracked port-forward sessions for a server.
func ListPortForwards(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	portForwardSessionsMu.RLock()
	sessions := append([]PortForwardSession(nil), portForwardSessions[server.ID]...)
	portForwardSessionsMu.RUnlock()

	c.JSON(http.StatusOK, gin.H{"success": true, "sessions": sessions})
}

// StopPortForward terminates a tracked port-forward session.
func StopPortForward(c *gin.Context) {
	id := c.Param("id")
	sessionID := c.Param("sessionId")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	portForwardSessionsMu.Lock()
	defer portForwardSessionsMu.Unlock()
	sessions := portForwardSessions[server.ID]
	idx := -1
	for i, s := range sessions {
		if s.ID == sessionID {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "port-forward session not found"})
		return
	}

	// Native Kill
	nativePFCannelsMu.Lock()
	if ch, ok := nativePFCannels[sessionID]; ok {
		close(ch)
		delete(nativePFCannels, sessionID)
		log.Printf("🛑 Native PortForward stopped: %s", sessionID)
	}
	nativePFCannelsMu.Unlock()

	portForwardSessions[server.ID] = append(sessions[:idx], sessions[idx+1:]...)
	c.JSON(http.StatusOK, gin.H{"success": true})
}
