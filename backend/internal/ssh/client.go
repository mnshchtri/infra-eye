package ssh

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type Client struct {
	ServerID uint
	Host     string
	Port     int
	User     string
	client   *gossh.Client
	mu       sync.Mutex
}

var (
	pool   = map[uint]*Client{}
	poolMu sync.RWMutex
)

func init() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		for range ticker.C {
			poolMu.RLock()
			for id, client := range pool {
				go func(id uint, c *Client) {
					// Minimal TCP-level check or simple cmd
					_, _, err := c.RunCommand("echo 1")
					if err != nil {
						// log.Printf("Background keep-alive failed for server %d", id)
						// We don't remove here, let the next GetOrCreate or RunCommand handle it
					}
				}(id, client)
			}
			poolMu.RUnlock()
		}
	}()
}

func NewClient(serverID uint, host string, port int, user, keyPath, password, authType string) (*Client, error) {
	var authMethods []gossh.AuthMethod

	switch authType {
	case "password":
		authMethods = append(authMethods, gossh.Password(password))
	default: // "key"
		if keyPath == "" {
			homeDir, _ := os.UserHomeDir()
			keyPath = homeDir + "/.ssh/id_rsa"
		}
		key, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("read SSH key: %w", err)
		}
		signer, err := gossh.ParsePrivateKey(key)
		if err != nil {
			return nil, fmt.Errorf("parse SSH key: %w", err)
		}
		authMethods = append(authMethods, gossh.PublicKeys(signer))
	}

	config := &gossh.ClientConfig{
		User:            user,
		Auth:            authMethods,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), // TODO: store known hosts
		Timeout:         10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := gossh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("dial SSH %s: %w", addr, err)
	}

	return &Client{
		ServerID: serverID,
		Host:     host,
		Port:     port,
		User:     user,
		client:   conn,
	}, nil
}

// RunCommand executes a command and returns (stdout, stderr, error)
func (c *Client) RunCommand(cmd string) (string, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	session, err := c.client.NewSession()
	if err != nil {
		return "", "", fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	var outBuf bytes.Buffer
	var errBuf bytes.Buffer
	session.Stdout = &outBuf
	session.Stderr = &errBuf

	if err := session.Run(cmd); err != nil {
		// return both buffers even on non-zero exit
		return outBuf.String(), errBuf.String(), err
	}
	return outBuf.String(), errBuf.String(), nil
}

// NewSession returns a raw SSH session for interactive terminal use
func (c *Client) NewSession() (*gossh.Session, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.client.NewSession()
}

// Dial creates a network connection through the SSH client (for tunneling)
func (c *Client) Dial(network, addr string) (net.Conn, error) {
	return c.client.Dial(network, addr)
}

func (c *Client) Close() {
	c.client.Close()
}

// ---- Pool management ----

func GetOrCreate(serverID uint, host string, port int, user, keyPath, password, authType string) (*Client, error) {
	poolMu.RLock()
	if c, ok := pool[serverID]; ok {
		poolMu.RUnlock()
		return c, nil
	}
	poolMu.RUnlock()

	c, err := NewClient(serverID, host, port, user, keyPath, password, authType)
	if err != nil {
		return nil, err
	}

	poolMu.Lock()
	pool[serverID] = c
	poolMu.Unlock()

	// Start a background keep-alive for this connection if not already running
	// (Simple version: one global ticker for the whole pool)
	return c, nil
}

func Remove(serverID uint) {
	poolMu.Lock()
	if c, ok := pool[serverID]; ok {
		c.Close()
		delete(pool, serverID)
	}
	poolMu.Unlock()
}
