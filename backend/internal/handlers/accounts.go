package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/logger"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
)

// OS account management on target servers (Cockpit-style "Accounts").
// All mutations are admin-only (see routes) and run over SSH with sudo.

type OSAccount struct {
	Username string `json:"username"`
	UID      int    `json:"uid"`
	Home     string `json:"home"`
	Shell    string `json:"shell"`
	IsAdmin  bool   `json:"is_admin"`
}

var usernameRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

// shQuote single-quotes a string for safe interpolation into a shell command.
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// sudoWrap prefixes a command with sudo, piping the stored password when the
// connection uses password auth for a non-root user (same pattern as logs.go).
func sudoWrap(server models.Server, cmd string) string {
	if server.SSHUser == "root" {
		return cmd
	}
	if server.AuthType == "password" && server.SSHPassword != "" {
		return fmt.Sprintf("echo %s | sudo -S %s", shQuote(server.SSHPassword), cmd)
	}
	return "sudo " + cmd
}

func accountServer(c *gin.Context) (*models.Server, *sshpool.Client, bool) {
	var server models.Server
	if err := db.DB.First(&server, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return nil, nil, false
	}
	if server.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "account management requires an SSH-connected server"})
		return nil, nil, false
	}
	if server.OS == "windows" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "account management is not yet supported on Windows servers"})
		return nil, nil, false
	}
	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("SSH connection failed: %v", err)})
		return nil, nil, false
	}
	return &server, client, true
}

// ListOSAccounts — GET /servers/:id/accounts
func ListOSAccounts(c *gin.Context) {
	server, client, ok := accountServer(c)
	if !ok {
		return
	}

	var accounts []OSAccount
	if server.OS == "darwin" {
		accounts = listDarwinAccounts(client)
	} else {
		accounts = listLinuxAccounts(client)
	}
	c.JSON(http.StatusOK, gin.H{"accounts": accounts, "os": server.OS})
}

func listLinuxAccounts(client *sshpool.Client) []OSAccount {
	accounts := []OSAccount{}
	out, _, _ := client.RunCommandTimeout("getent passwd", cmdTimeout)
	adminsOut, _, _ := client.RunCommandTimeout("getent group sudo wheel admin 2>/dev/null | cut -d: -f4 | tr ',' '\\n'", cmdTimeout)

	admins := map[string]bool{}
	for _, l := range strings.Split(adminsOut, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			admins[l] = true
		}
	}

	for _, line := range strings.Split(out, "\n") {
		parts := strings.Split(line, ":")
		if len(parts) < 7 {
			continue
		}
		uid, err := strconv.Atoi(parts[2])
		if err != nil {
			continue
		}
		// Human accounts (uid >= 1000) plus root; skip nobody
		if (uid < 1000 && uid != 0) || uid >= 65534 {
			continue
		}
		accounts = append(accounts, OSAccount{
			Username: parts[0],
			UID:      uid,
			Home:     parts[5],
			Shell:    parts[6],
			IsAdmin:  uid == 0 || admins[parts[0]],
		})
	}
	return accounts
}

func listDarwinAccounts(client *sshpool.Client) []OSAccount {
	accounts := []OSAccount{}
	uidOut, _, _ := client.RunCommandTimeout("dscl . -list /Users UniqueID", cmdTimeout)
	homeOut, _, _ := client.RunCommandTimeout("dscl . -list /Users NFSHomeDirectory", cmdTimeout)
	shellOut, _, _ := client.RunCommandTimeout("dscl . -list /Users UserShell", cmdTimeout)
	adminOut, _, _ := client.RunCommandTimeout("dscl . -read /Groups/admin GroupMembership 2>/dev/null", cmdTimeout)

	kv := func(out string) map[string]string {
		m := map[string]string{}
		for _, l := range strings.Split(out, "\n") {
			f := strings.Fields(l)
			if len(f) >= 2 {
				m[f[0]] = f[1]
			}
		}
		return m
	}
	homes := kv(homeOut)
	shells := kv(shellOut)

	admins := map[string]bool{}
	for _, f := range strings.Fields(strings.TrimPrefix(strings.TrimSpace(adminOut), "GroupMembership:")) {
		admins[f] = true
	}

	for _, l := range strings.Split(uidOut, "\n") {
		f := strings.Fields(l)
		if len(f) < 2 {
			continue
		}
		uid, err := strconv.Atoi(f[1])
		if err != nil {
			continue
		}
		if (uid < 500 && uid != 0) || strings.HasPrefix(f[0], "_") {
			continue
		}
		accounts = append(accounts, OSAccount{
			Username: f[0],
			UID:      uid,
			Home:     homes[f[0]],
			Shell:    shells[f[0]],
			IsAdmin:  uid == 0 || admins[f[0]],
		})
	}
	return accounts
}

type createAccountRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
	Admin    bool   `json:"admin"`
	SSHKey   string `json:"ssh_key"`
}

// CreateOSAccount — POST /servers/:id/accounts
func CreateOSAccount(c *gin.Context) {
	var req createAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !usernameRe.MatchString(req.Username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username: lowercase letters, digits, - and _ only (max 32 chars)"})
		return
	}
	if req.SSHKey != "" && !strings.HasPrefix(strings.TrimSpace(req.SSHKey), "ssh-") && !strings.HasPrefix(strings.TrimSpace(req.SSHKey), "ecdsa-") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ssh_key must be an OpenSSH public key (ssh-ed25519/ssh-rsa/ecdsa-…)"})
		return
	}

	server, client, ok := accountServer(c)
	if !ok {
		return
	}

	var script string
	if server.OS == "darwin" {
		adminFlag := ""
		if req.Admin {
			adminFlag = "-admin"
		}
		script = fmt.Sprintf("sysadminctl -addUser %s -password %s %s 2>&1", req.Username, shQuote(req.Password), adminFlag)
	} else {
		lines := []string{
			fmt.Sprintf("useradd -m -s /bin/bash %s 2>&1", req.Username),
			fmt.Sprintf("echo %s | chpasswd 2>&1", shQuote(req.Username+":"+req.Password)),
		}
		if req.Admin {
			lines = append(lines, fmt.Sprintf("if getent group sudo >/dev/null; then usermod -aG sudo %s; else usermod -aG wheel %s; fi 2>&1", req.Username, req.Username))
		}
		if key := strings.TrimSpace(req.SSHKey); key != "" {
			lines = append(lines,
				fmt.Sprintf("mkdir -p /home/%s/.ssh && echo %s >> /home/%s/.ssh/authorized_keys && chmod 700 /home/%s/.ssh && chmod 600 /home/%s/.ssh/authorized_keys && chown -R %s: /home/%s/.ssh 2>&1",
					req.Username, shQuote(key), req.Username, req.Username, req.Username, req.Username, req.Username))
		}
		script = "sh -c " + shQuote(strings.Join(lines, " && "))
	}

	stdout, stderr, err := client.RunCommandTimeout(sudoWrap(*server, script), cmdTimeout)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": firstNonEmpty(stderr, stdout, err.Error())})
		return
	}
	logger.RecordLog(server.ID, "accounts", "info", fmt.Sprintf("OS user created: %s (admin=%v) by %s", req.Username, req.Admin, c.GetString("username")))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("user %s created", req.Username)})
}

type modifyAccountRequest struct {
	Admin *bool `json:"admin"`
}

// UpdateOSAccount — PUT /servers/:id/accounts/:username (toggle admin privilege)
func UpdateOSAccount(c *gin.Context) {
	username := c.Param("username")
	if !usernameRe.MatchString(username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username"})
		return
	}
	var req modifyAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Admin == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body must include {\"admin\": true|false}"})
		return
	}

	server, client, ok := accountServer(c)
	if !ok {
		return
	}
	if username == server.SSHUser && !*req.Admin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refusing to remove admin from the connection user — InfraEye would lose sudo on this server"})
		return
	}

	var script string
	if server.OS == "darwin" {
		op := "-a"
		if !*req.Admin {
			op = "-d"
		}
		script = fmt.Sprintf("dseditgroup -o edit %s %s -t user admin 2>&1", op, username)
	} else {
		if *req.Admin {
			script = fmt.Sprintf("sh -c 'if getent group sudo >/dev/null; then usermod -aG sudo %s; else usermod -aG wheel %s; fi' 2>&1", username, username)
		} else {
			script = fmt.Sprintf("sh -c 'gpasswd -d %s sudo 2>/dev/null; gpasswd -d %s wheel 2>/dev/null; true' 2>&1", username, username)
		}
	}

	stdout, stderr, err := client.RunCommandTimeout(sudoWrap(*server, script), cmdTimeout)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": firstNonEmpty(stderr, stdout, err.Error())})
		return
	}
	logger.RecordLog(server.ID, "accounts", "info", fmt.Sprintf("OS user privilege changed: %s admin=%v by %s", username, *req.Admin, c.GetString("username")))
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteOSAccount — DELETE /servers/:id/accounts/:username
func DeleteOSAccount(c *gin.Context) {
	username := c.Param("username")
	if !usernameRe.MatchString(username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username"})
		return
	}
	if username == "root" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refusing to delete root"})
		return
	}

	server, client, ok := accountServer(c)
	if !ok {
		return
	}
	if username == server.SSHUser {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refusing to delete the SSH connection user — InfraEye would lose access to this server"})
		return
	}

	var script string
	if server.OS == "darwin" {
		script = fmt.Sprintf("sysadminctl -deleteUser %s 2>&1", username)
	} else {
		script = fmt.Sprintf("userdel -r %s 2>&1", username)
	}

	stdout, stderr, err := client.RunCommandTimeout(sudoWrap(*server, script), cmdTimeout)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": firstNonEmpty(stderr, stdout, err.Error())})
		return
	}
	logger.RecordLog(server.ID, "accounts", "info", fmt.Sprintf("OS user deleted: %s by %s", username, c.GetString("username")))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": fmt.Sprintf("user %s deleted", username)})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return "command failed"
}
