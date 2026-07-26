package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// startMCPSidecar mirrors dev.sh's native-binary discovery: it looks for
// kubernetes-mcp-server on PATH and spawns it pointed at the desktop app's
// own kubeconfig file. If the binary isn't installed, Kubernetes-cluster
// features degrade gracefully (MCP calls just get connection-refused from
// :8090); Linux-server SSH features are entirely unaffected either way.
func startMCPSidecar(kubeconfigPath, logDir string) *exec.Cmd {
	bin, err := exec.LookPath("kubernetes-mcp-server")
	if err != nil {
		log.Println("⚠️  kubernetes-mcp-server not found on PATH; Kubernetes cluster features will be unavailable")
		return nil
	}

	cmd := exec.Command(bin,
		"--port", "8090",
		"--kubeconfig", kubeconfigPath,
		"--cluster-provider", "kubeconfig",
	)

	if logDir != "" {
		if f, err := os.Create(filepath.Join(logDir, "mcp-server.log")); err == nil {
			cmd.Stdout = f
			cmd.Stderr = f
		}
	}

	if err := cmd.Start(); err != nil {
		log.Printf("⚠️  failed to start kubernetes-mcp-server: %v", err)
		return nil
	}

	log.Printf("✅ kubernetes-mcp-server started natively (pid %d)", cmd.Process.Pid)
	return cmd
}

// stopMCPSidecar terminates a process started by startMCPSidecar, if any.
func stopMCPSidecar(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	_ = cmd.Process.Signal(os.Interrupt)
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}
}
