package handlers

import (
	"context"
	"net/http"
	"sort"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type K8sServiceAccountInfo struct {
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	CreatedAt string   `json:"created_at"`
	Roles     []string `json:"roles"`
}

// GetK8sAccounts lists every ServiceAccount in the cluster together with the
// Roles/ClusterRoles bound to it — the cluster-side equivalent of the OS
// accounts view for SSH servers.
func GetK8sAccounts(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	if !server.IsK8s || server.KubeConfig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service accounts require a Kubernetes-connected cluster"})
		return
	}

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return
	}

	ctx := context.Background()

	saList, err := clientset.CoreV1().ServiceAccounts("").List(ctx, metav1.ListOptions{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list service accounts: " + err.Error()})
		return
	}

	// Map "namespace/name" -> bound roles, from both binding kinds. Listing can
	// fail on restricted kubeconfigs — degrade to an empty roles column then.
	roleMap := map[string][]string{}
	if crbs, err := clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{}); err == nil {
		for _, crb := range crbs.Items {
			for _, sub := range crb.Subjects {
				if sub.Kind == "ServiceAccount" {
					key := sub.Namespace + "/" + sub.Name
					roleMap[key] = append(roleMap[key], "ClusterRole/"+crb.RoleRef.Name)
				}
			}
		}
	}
	if rbs, err := clientset.RbacV1().RoleBindings("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, rb := range rbs.Items {
			for _, sub := range rb.Subjects {
				if sub.Kind == "ServiceAccount" {
					ns := sub.Namespace
					if ns == "" {
						ns = rb.Namespace
					}
					key := ns + "/" + sub.Name
					roleMap[key] = append(roleMap[key], rb.RoleRef.Kind+"/"+rb.RoleRef.Name)
				}
			}
		}
	}

	accounts := make([]K8sServiceAccountInfo, 0, len(saList.Items))
	for _, sa := range saList.Items {
		roles := roleMap[sa.Namespace+"/"+sa.Name]
		if roles == nil {
			roles = []string{}
		}
		accounts = append(accounts, K8sServiceAccountInfo{
			Name:      sa.Name,
			Namespace: sa.Namespace,
			CreatedAt: sa.CreationTimestamp.Format("2006-01-02 15:04"),
			Roles:     roles,
		})
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Namespace != accounts[j].Namespace {
			return accounts[i].Namespace < accounts[j].Namespace
		}
		return accounts[i].Name < accounts[j].Name
	})

	c.JSON(http.StatusOK, gin.H{"accounts": accounts})
}
