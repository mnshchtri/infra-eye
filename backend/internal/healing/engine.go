package healing

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
	"github.com/infra-eye/backend/internal/alerts"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

var lastFired = map[uint]time.Time{}

func StartEngine() {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			evaluate()
		}
	}()
	log.Println("✅ Self-healing engine started")
}

func evaluate() {
	var rules []models.AlertRule
	db.DB.Where("enabled = true").Find(&rules)

	for _, rule := range rules {
		checkRule(rule)
	}
}

func checkRule(rule models.AlertRule) {
	// Cooldown check
	if last, ok := lastFired[rule.ID]; ok {
		if time.Since(last) < time.Duration(rule.CooldownMinutes)*time.Minute {
			return
		}
	}

	// Get applicable servers
	var servers []models.Server
	if rule.ServerID > 0 {
		db.DB.Where("id = ?", rule.ServerID).Find(&servers)
	} else {
		db.DB.Find(&servers)
	}

	for _, server := range servers {
		if triggered, info := evaluateCondition(rule, server); triggered {
			fireAction(rule, server, info)
		}
	}
}

func evaluateCondition(rule models.AlertRule, server models.Server) (bool, string) {
	var metric models.Metric
	if err := db.DB.Where("server_id = ?", server.ID).Order("timestamp DESC").First(&metric).Error; err != nil {
		return false, ""
	}

	threshold, err := strconv.ParseFloat(rule.ConditionValue, 64)
	if err != nil && rule.ConditionType != "log_keyword" {
		return false, ""
	}

	var actual float64
	var label string

	switch rule.ConditionType {
	case "cpu":
		actual = metric.CPUPercent
		label = fmt.Sprintf("CPU=%.1f%%", actual)
	case "mem":
		actual = metric.MemPercent
		label = fmt.Sprintf("Memory=%.1f%%", actual)
	case "disk":
		actual = metric.DiskPercent
		label = fmt.Sprintf("Disk=%.1f%%", actual)
	case "load":
		actual = metric.LoadAvg1
		label = fmt.Sprintf("Load=%.2f", actual)
	case "pod_status":
		// This checks for any pods NOT in Running/Succeeded state
		// We reuse the Pulse logic from ai.go which is already optimized
		failing, err := getFailingPodsCount(server)
		if err != nil {
			return false, ""
		}
		if failing > 0 {
			return true, fmt.Sprintf("%d pods are NOT running/succeeded", failing)
		}
		return false, ""
	default:
		return false, ""
	}

	switch rule.ConditionOp {
	case "gt":
		if actual > threshold {
			return true, fmt.Sprintf("%s > %.1f", label, threshold)
		}
	case "lt":
		if actual < threshold {
			return true, fmt.Sprintf("%s < %.1f", label, threshold)
		}
	case "gte":
		if actual >= threshold {
			return true, fmt.Sprintf("%s >= %.1f", label, threshold)
		}
	}
	return false, ""
}

func fireAction(rule models.AlertRule, server models.Server, info string) {
	log.Printf("🔔 Alert [%s] triggered on server %s: %s", rule.Name, server.Name, info)
	lastFired[rule.ID] = time.Now()

	action := models.HealingAction{
		AlertRuleID: rule.ID,
		ServerID:    server.ID,
		TriggerInfo: info,
		Command:     rule.ActionCommand,
		Status:      "pending",
	}

	if rule.ActionType == "ssh_command" && strings.TrimSpace(rule.ActionCommand) != "" {
		client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port,
			server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
		if err != nil {
			action.Output = fmt.Sprintf("SSH connect error: %v", err)
			action.Status = "failed"
		} else {
			stdout, stderr, err := client.RunCommand(rule.ActionCommand)
			action.Output = stdout
			if err != nil {
				action.Output = fmt.Sprintf("Error: %v\nStderr: %s\nStdout: %s", err, stderr, stdout)
				action.Status = "failed"
			} else {
				action.Status = "success"
			}
		}
		log.Printf("Healing action [%s] on %s: %s", rule.ActionCommand, server.Name, action.Status)
	} else {
		action.Output = "notification-only rule"
		action.Status = "success"
	}

	db.DB.Create(&action)

	// Broadcast to the global alerts room so connected frontends get a real-time toast
	ws.GlobalHub.Broadcast("alerts", "alert_fired", map[string]interface{}{
		"rule_name":   rule.Name,
		"server_name": server.Name,
		"server_id":   server.ID,
		"trigger_info": info,
		"severity":    rule.Severity,
		"action_type": rule.ActionType,
		"status":      action.Status,
	})

	// Dispatch to external Webhooks
	go alerts.SendToGoogleChat(rule.Name, server.Name, info, rule.Severity, action.Status, action.Output)
	go alerts.SendToSlack(rule.Name, server.Name, info, rule.Severity, action.Status)
}

func getFailingPodsCount(server models.Server) (int, error) {
	if server.KubeConfig == "" {
		return 0, nil
	}

	config, err := clientcmd.RESTConfigFromKubeConfig([]byte(server.KubeConfig))
	if err != nil {
		return 0, err
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return 0, err
	}

	pods, err := clientset.CoreV1().Pods("").List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		return 0, err
	}

	failing := 0
	for _, p := range pods.Items {
		if p.Status.Phase != "Running" && p.Status.Phase != "Succeeded" {
			failing++
		}
	}
	return failing, nil
}
