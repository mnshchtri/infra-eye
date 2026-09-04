package handlers

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	authenticationv1 "k8s.io/api/authentication/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// Where the generated identities live. A dedicated namespace rather than
// kube-system so every credential InfraEye hands out is visible, auditable, and
// removable in one place (`kubectl delete ns read-only` revokes them all).
const (
	readOnlyNamespace   = "read-only"
	readOnlyClusterRole = "read-only"
	readOnlySAPrefix    = "read-only-"
)

// maxTokenTTL is the ceiling the API server itself enforces on TokenRequest in
// most distributions; asking for more is silently truncated, so we reject it up
// front rather than hand back a kubeconfig that dies earlier than the UI claims.
const maxTokenTTLDays = 365

// readOnlyRules is the permission set for generated kubeconfigs: read
// everything, write nothing.
//
// This deliberately does NOT use the built-in `view` ClusterRole. `view`
// excludes Secrets and every cluster-scoped resource (nodes, PVs,
// storageclasses), which is not what was asked for here — the holder is meant
// to be able to inspect the whole cluster, secrets and pod logs included.
//
// SECURITY: read access to Secrets cluster-wide is a genuine escalation path —
// the holder can read any credential stored in the cluster, including
// long-lived ServiceAccount token Secrets belonging to more privileged
// accounts. That is inherent to "let them read secrets", not an oversight. Hand
// these kubeconfigs out accordingly.
func readOnlyRules() []rbacv1.PolicyRule {
	return []rbacv1.PolicyRule{
		{
			// Every resource in every API group, including CRDs added later.
			// The wildcard covers subresources too.
			APIGroups: []string{"*"},
			Resources: []string{"*"},
			Verbs:     []string{"get", "list", "watch"},
		},
		{
			// Redundant against the wildcard above, but stated explicitly so
			// that narrowing the wildcard later cannot silently take away log
			// access, which is a headline reason these are handed out.
			APIGroups: []string{""},
			Resources: []string{"pods/log", "pods/status"},
			Verbs:     []string{"get", "list", "watch"},
		},
		{
			// /healthz, /version, /openapi — kubectl calls these for discovery
			// and prints confusing errors without them.
			NonResourceURLs: []string{"*"},
			Verbs:           []string{"get"},
		},
		{
			// Lets the holder run `kubectl auth can-i`. This is exactly what the
			// built-in system:basic-user grants and exposes no cluster data — it
			// only answers questions about the caller's own permissions.
			APIGroups: []string{"authorization.k8s.io"},
			Resources: []string{"selfsubjectaccessreviews", "selfsubjectrulesreviews"},
			Verbs:     []string{"create"},
		},
	}
}

// Verbs granting write/exec are absent above by construction. Spelled out here
// so a reviewer can see what the holder cannot do: create, update, patch,
// delete, deletecollection, and therefore also `kubectl exec` and
// `kubectl port-forward`, both of which POST to a subresource.

var slugUnsafe = regexp.MustCompile(`[^a-z0-9-]+`)

// slugifyName turns a human label ("Alice Smith", "team/backend") into a valid
// RFC 1123 DNS label usable as a ServiceAccount name.
func slugifyName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugUnsafe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	// Leave room for the prefix within the 63-char label limit.
	if max := 63 - len(readOnlySAPrefix); len(s) > max {
		s = strings.Trim(s[:max], "-")
	}
	return s
}

type readOnlyKubeconfigRequest struct {
	// Name identifies who the credential is for; it becomes part of the
	// ServiceAccount name so access can be revoked per person.
	Name string `json:"name" binding:"required"`
	// ExpiresInDays of 0 means a non-expiring token backed by a Secret.
	ExpiresInDays int `json:"expires_in_days"`
	// ServerURL overrides the API server address written into the generated
	// kubeconfig. The stored admin kubeconfig often points somewhere only the
	// InfraEye host can reach (127.0.0.1, host.docker.internal, a LAN IP), which
	// would be useless to the developer receiving this file.
	ServerURL string `json:"server_url"`
}

// GenerateReadOnlyKubeconfig provisions a read-only identity in the cluster and
// returns a ready-to-use kubeconfig for it.
//
// POST /api/servers/:id/k8s/readonly-kubeconfig
//
// This writes to the target cluster: a namespace, a ClusterRole, a
// ServiceAccount, and a ClusterRoleBinding. Repeat calls for the same name
// reuse the existing identity and mint a fresh token rather than duplicating it.
func GenerateReadOnlyKubeconfig(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var req readOnlyKubeconfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	slug := slugifyName(req.Name)
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name must contain at least one letter or digit"})
		return
	}
	if req.ExpiresInDays < 0 || req.ExpiresInDays > maxTokenTTLDays {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("expires_in_days must be between 0 (never) and %d", maxTokenTTLDays),
		})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	if !server.IsK8s || server.KubeConfig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this server is not a Kubernetes-connected cluster"})
		return
	}

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return
	}

	ctx := context.Background()
	if denyIfReadOnlyConnection(c, ctx, clientset) {
		return
	}
	saName := readOnlySAPrefix + slug

	if err := ensureReadOnlyRBAC(ctx, clientset, saName); err != nil {
		// Pass the API server's own message through — an RBAC failure here is
		// almost always a permissions problem on the stored admin kubeconfig,
		// and the verbatim error says exactly which verb was refused.
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	token, expiresAt, err := mintServiceAccountToken(ctx, clientset, saName, req.ExpiresInDays)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	kubeconfig, err := buildReadOnlyKubeconfig(ctx, clientset, server, saName, token, req.ServerURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp := gin.H{
		"kubeconfig":      kubeconfig,
		"service_account": saName,
		"namespace":       readOnlyNamespace,
		"cluster_role":    readOnlyClusterRole,
		"filename":        fmt.Sprintf("%s-%s.kubeconfig.yaml", slugifyName(server.Name), slug),
	}
	if expiresAt != nil {
		resp["expires_at"] = expiresAt.UTC().Format(time.RFC3339)
	}
	c.JSON(http.StatusOK, resp)
}

// whoAmI reports the identity the stored kubeconfig authenticates as, for error
// messages. Best-effort: SelfSubjectReview is Kubernetes 1.28+, and older
// clusters simply get a less specific message.
func whoAmI(ctx context.Context, cs *kubernetes.Clientset) string {
	rev, err := cs.AuthenticationV1().SelfSubjectReviews().Create(ctx, &authenticationv1.SelfSubjectReview{}, metav1.CreateOptions{})
	if err != nil {
		return ""
	}
	return rev.Status.UserInfo.Username
}

// canManageRBAC asks the API server whether the stored credential may create
// the objects this feature needs, rather than finding out halfway through.
//
// Creating a ClusterRoleBinding is the privileged step — a credential that can
// do it can grant itself anything — so it stands in for the whole set. This
// matters because a cluster can legitimately be registered in InfraEye using a
// read-only kubeconfig (including one this feature generated), and on those the
// generate and revoke actions cannot work at all.
func canManageRBAC(ctx context.Context, cs *kubernetes.Clientset) (bool, error) {
	review, err := cs.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Group:    "rbac.authorization.k8s.io",
				Resource: "clusterrolebindings",
				Verb:     "create",
			},
		},
	}, metav1.CreateOptions{})
	if err != nil {
		return false, err
	}
	return review.Status.Allowed, nil
}

// denyIfReadOnlyConnection aborts with a 403 explaining the situation when the
// stored credential cannot manage RBAC. Without this the caller gets a raw
// Forbidden from partway through provisioning, naming a ServiceAccount they
// never chose and giving no hint that the cluster connection itself is the
// problem.
func denyIfReadOnlyConnection(c *gin.Context, ctx context.Context, cs *kubernetes.Clientset) bool {
	ok, err := canManageRBAC(ctx, cs)
	if err != nil {
		// Couldn't ask — let the real operation proceed and surface its own error.
		return false
	}
	if ok {
		return false
	}
	msg := "InfraEye is connected to this cluster with a credential that cannot manage RBAC, so it cannot issue or revoke access here."
	if who := whoAmI(ctx, cs); who != "" {
		msg = fmt.Sprintf("InfraEye is connected to this cluster as %q, which cannot manage RBAC, so it cannot issue or revoke access here.", who)
	}
	c.JSON(http.StatusForbidden, gin.H{
		"error": msg + " Register the cluster with an admin kubeconfig to manage read-only access from it.",
	})
	return true
}

// ensureReadOnlyRBAC makes the namespace, ClusterRole, ServiceAccount, and
// ClusterRoleBinding exist and match the intended definition. Idempotent: safe
// to call repeatedly, and it re-applies the rules so a ClusterRole edited by
// hand is corrected on the next generation.
func ensureReadOnlyRBAC(ctx context.Context, cs *kubernetes.Clientset, saName string) error {
	// Namespace
	_, err := cs.CoreV1().Namespaces().Get(ctx, readOnlyNamespace, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = cs.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name:   readOnlyNamespace,
				Labels: map[string]string{"app.kubernetes.io/managed-by": "infraeye"},
			},
		}, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("create namespace %s: %w", readOnlyNamespace, err)
		}
	} else if err != nil {
		return fmt.Errorf("check namespace %s: %w", readOnlyNamespace, err)
	}

	// ClusterRole
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:   readOnlyClusterRole,
			Labels: map[string]string{"app.kubernetes.io/managed-by": "infraeye"},
		},
		Rules: readOnlyRules(),
	}
	existing, err := cs.RbacV1().ClusterRoles().Get(ctx, readOnlyClusterRole, metav1.GetOptions{})
	switch {
	case apierrors.IsNotFound(err):
		if _, err := cs.RbacV1().ClusterRoles().Create(ctx, cr, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("create ClusterRole %s: %w", readOnlyClusterRole, err)
		}
	case err != nil:
		return fmt.Errorf("check ClusterRole %s: %w", readOnlyClusterRole, err)
	default:
		existing.Rules = cr.Rules
		if _, err := cs.RbacV1().ClusterRoles().Update(ctx, existing, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("update ClusterRole %s: %w", readOnlyClusterRole, err)
		}
	}

	// ServiceAccount
	_, err = cs.CoreV1().ServiceAccounts(readOnlyNamespace).Get(ctx, saName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = cs.CoreV1().ServiceAccounts(readOnlyNamespace).Create(ctx, &corev1.ServiceAccount{
			ObjectMeta: metav1.ObjectMeta{
				Name:      saName,
				Namespace: readOnlyNamespace,
				Labels:    map[string]string{"app.kubernetes.io/managed-by": "infraeye"},
			},
		}, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("create ServiceAccount %s: %w", saName, err)
		}
	} else if err != nil {
		return fmt.Errorf("check ServiceAccount %s: %w", saName, err)
	}

	// ClusterRoleBinding, one per identity so revoking one person does not
	// affect the others.
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   saName,
			Labels: map[string]string{"app.kubernetes.io/managed-by": "infraeye"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: rbacv1.GroupName,
			Kind:     "ClusterRole",
			Name:     readOnlyClusterRole,
		},
		Subjects: []rbacv1.Subject{{
			Kind:      "ServiceAccount",
			Name:      saName,
			Namespace: readOnlyNamespace,
		}},
	}
	existingCRB, err := cs.RbacV1().ClusterRoleBindings().Get(ctx, saName, metav1.GetOptions{})
	switch {
	case apierrors.IsNotFound(err):
		if _, err := cs.RbacV1().ClusterRoleBindings().Create(ctx, crb, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("create ClusterRoleBinding %s: %w", saName, err)
		}
	case err != nil:
		return fmt.Errorf("check ClusterRoleBinding %s: %w", saName, err)
	default:
		// RoleRef is immutable; only the subject list can be corrected.
		existingCRB.Subjects = crb.Subjects
		if _, err := cs.RbacV1().ClusterRoleBindings().Update(ctx, existingCRB, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("update ClusterRoleBinding %s: %w", saName, err)
		}
	}

	return nil
}

// mintServiceAccountToken returns a bearer token for the ServiceAccount.
//
// With expiresInDays > 0 it uses the TokenRequest API, so the credential dies on
// its own and a leaked kubeconfig stops working without any revocation step.
// With 0 it falls back to a long-lived Secret-backed token, which is valid until
// the ServiceAccount is deleted.
func mintServiceAccountToken(ctx context.Context, cs *kubernetes.Clientset, saName string, expiresInDays int) (string, *time.Time, error) {
	if expiresInDays > 0 {
		seconds := int64(expiresInDays) * 24 * 60 * 60
		tr, err := cs.CoreV1().ServiceAccounts(readOnlyNamespace).CreateToken(ctx, saName, &authenticationv1.TokenRequest{
			Spec: authenticationv1.TokenRequestSpec{ExpirationSeconds: &seconds},
		}, metav1.CreateOptions{})
		if err != nil {
			return "", nil, fmt.Errorf("request token for %s: %w", saName, err)
		}
		// The API server caps the TTL at its own --service-account-max-token-expiration
		// and reports what it actually granted, which may be shorter than asked.
		exp := tr.Status.ExpirationTimestamp.Time
		return tr.Status.Token, &exp, nil
	}

	// Non-expiring: a Secret of type service-account-token, populated
	// asynchronously by the token controller.
	secretName := saName + "-token"
	_, err := cs.CoreV1().Secrets(readOnlyNamespace).Get(ctx, secretName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		_, err = cs.CoreV1().Secrets(readOnlyNamespace).Create(ctx, &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:        secretName,
				Namespace:   readOnlyNamespace,
				Annotations: map[string]string{corev1.ServiceAccountNameKey: saName},
				Labels:      map[string]string{"app.kubernetes.io/managed-by": "infraeye"},
			},
			Type: corev1.SecretTypeServiceAccountToken,
		}, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return "", nil, fmt.Errorf("create token secret for %s: %w", saName, err)
		}
	} else if err != nil {
		return "", nil, fmt.Errorf("check token secret for %s: %w", saName, err)
	}

	// Poll briefly for the controller to fill in the token.
	for i := 0; i < 20; i++ {
		sec, err := cs.CoreV1().Secrets(readOnlyNamespace).Get(ctx, secretName, metav1.GetOptions{})
		if err == nil && len(sec.Data["token"]) > 0 {
			return string(sec.Data["token"]), nil, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return "", nil, fmt.Errorf("timed out waiting for the cluster to populate the token for %s "+
		"(the ServiceAccount token controller may be disabled — try an expiring token instead)", saName)
}

// buildReadOnlyKubeconfig assembles a single-context kubeconfig pointing at the
// same API server as the stored admin config, authenticating as the generated
// ServiceAccount.
func buildReadOnlyKubeconfig(ctx context.Context, cs *kubernetes.Clientset, server models.Server, saName, token, serverURLOverride string) (string, error) {
	adminCfg, err := clientcmd.Load([]byte(server.KubeConfig))
	if err != nil {
		return "", fmt.Errorf("parse stored kubeconfig: %w", err)
	}

	// Mirror GetRestConfig's auto-heal so a config with a stale current-context
	// still resolves to a usable cluster entry.
	ctxName := adminCfg.CurrentContext
	if _, ok := adminCfg.Contexts[ctxName]; !ok {
		for k := range adminCfg.Contexts {
			ctxName = k
			break
		}
	}
	kctx, ok := adminCfg.Contexts[ctxName]
	if !ok {
		return "", fmt.Errorf("stored kubeconfig has no usable context")
	}
	srcCluster, ok := adminCfg.Clusters[kctx.Cluster]
	if !ok {
		return "", fmt.Errorf("stored kubeconfig has no cluster entry for context %q", ctxName)
	}

	apiServer := srcCluster.Server
	if strings.TrimSpace(serverURLOverride) != "" {
		apiServer = strings.TrimSpace(serverURLOverride)
	}

	caData := srcCluster.CertificateAuthorityData
	if len(caData) == 0 && !srcCluster.InsecureSkipTLSVerify {
		// The stored config referenced a CA file that only exists on whatever
		// machine wrote it. Every namespace publishes the cluster CA in the
		// kube-root-ca.crt ConfigMap, so read it from the cluster itself.
		if cm, err := cs.CoreV1().ConfigMaps(readOnlyNamespace).Get(ctx, "kube-root-ca.crt", metav1.GetOptions{}); err == nil {
			caData = []byte(cm.Data["ca.crt"])
		}
	}

	clusterName := slugifyName(server.Name)
	if clusterName == "" {
		clusterName = "cluster"
	}
	contextName := clusterName + "-readonly"

	out := clientcmdapi.NewConfig()
	out.Clusters[clusterName] = &clientcmdapi.Cluster{
		Server:                   apiServer,
		CertificateAuthorityData: caData,
		InsecureSkipTLSVerify:    len(caData) == 0 && srcCluster.InsecureSkipTLSVerify,
	}
	out.AuthInfos[saName] = &clientcmdapi.AuthInfo{Token: token}
	out.Contexts[contextName] = &clientcmdapi.Context{
		Cluster:   clusterName,
		AuthInfo:  saName,
		Namespace: "default",
	}
	out.CurrentContext = contextName

	data, err := clientcmd.Write(*out)
	if err != nil {
		return "", fmt.Errorf("serialize kubeconfig: %w", err)
	}
	return string(data), nil
}

// ReadOnlyIdentity is one previously generated credential, for the UI's list.
type ReadOnlyIdentity struct {
	Name        string `json:"name"` // the slug, i.e. who it was generated for
	ServiceAcct string `json:"service_account"`
	CreatedAt   string `json:"created_at"`
	HasStatic   bool   `json:"has_static_token"` // a non-expiring Secret-backed token exists
}

// ListReadOnlyKubeconfigs reports the identities InfraEye has generated for this
// cluster, so they can be reviewed and revoked individually.
//
// GET /api/servers/:id/k8s/readonly-kubeconfig
func ListReadOnlyKubeconfigs(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	cs, server, ok := readOnlyClusterClient(c)
	if !ok {
		return
	}
	ctx := context.Background()

	// The dialog prefills this so the operator can see — and correct — the
	// address the developer's kubeconfig will point at. The stored one is often
	// only reachable from the InfraEye host.
	apiServer := storedAPIServerURL(server)

	sas, err := cs.CoreV1().ServiceAccounts(readOnlyNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			// Namespace doesn't exist yet — nothing has been generated.
			canManage, cmErr := canManageRBAC(ctx, cs)
			if cmErr != nil {
				canManage = true
			}
			c.JSON(http.StatusOK, gin.H{
				"identities": []ReadOnlyIdentity{}, "api_server": apiServer,
				"can_manage": canManage, "connected_as": whoAmI(ctx, cs),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// One list call rather than a Get per identity.
	staticTokens := map[string]bool{}
	if secrets, err := cs.CoreV1().Secrets(readOnlyNamespace).List(ctx, metav1.ListOptions{}); err == nil {
		for _, s := range secrets.Items {
			if s.Type == corev1.SecretTypeServiceAccountToken {
				staticTokens[s.Annotations[corev1.ServiceAccountNameKey]] = true
			}
		}
	}

	out := []ReadOnlyIdentity{}
	for _, sa := range sas.Items {
		if !strings.HasPrefix(sa.Name, readOnlySAPrefix) {
			continue
		}
		out = append(out, ReadOnlyIdentity{
			Name:        strings.TrimPrefix(sa.Name, readOnlySAPrefix),
			ServiceAcct: sa.Name,
			CreatedAt:   sa.CreationTimestamp.UTC().Format(time.RFC3339),
			HasStatic:   staticTokens[sa.Name],
		})
	}
	canManage, err := canManageRBAC(ctx, cs)
	if err != nil {
		canManage = true // couldn't ask; don't disable the UI on a guess
	}
	c.JSON(http.StatusOK, gin.H{
		"identities":   out,
		"api_server":   apiServer,
		"can_manage":   canManage,
		"connected_as": whoAmI(ctx, cs),
	})
}

// storedAPIServerURL reports the API server address in the cluster's stored
// kubeconfig, or "" if it cannot be determined. Only the endpoint is exposed —
// never the credentials alongside it.
func storedAPIServerURL(server models.Server) string {
	cfg, err := clientcmd.Load([]byte(server.KubeConfig))
	if err != nil {
		return ""
	}
	name := cfg.CurrentContext
	if _, ok := cfg.Contexts[name]; !ok {
		for k := range cfg.Contexts {
			name = k
			break
		}
	}
	if kctx, ok := cfg.Contexts[name]; ok {
		if cl, ok := cfg.Clusters[kctx.Cluster]; ok {
			return cl.Server
		}
	}
	return ""
}

// RevokeReadOnlyKubeconfig deletes one generated identity. Removing the
// ServiceAccount invalidates every token ever issued for it — including
// still-unexpired ones — because token validation resolves the account's UID.
//
// DELETE /api/servers/:id/k8s/readonly-kubeconfig/:name
func RevokeReadOnlyKubeconfig(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	cs, _, ok := readOnlyClusterClient(c)
	if !ok {
		return
	}
	slug := slugifyName(c.Param("name"))
	if slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid name"})
		return
	}
	saName := readOnlySAPrefix + slug
	ctx := context.Background()
	if denyIfReadOnlyConnection(c, ctx, cs) {
		return
	}

	// Binding first: if the SA delete then fails, what is left behind is a
	// binding pointing at nothing rather than a live credential.
	if err := cs.RbacV1().ClusterRoleBindings().Delete(ctx, saName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete ClusterRoleBinding: " + err.Error()})
		return
	}
	if err := cs.CoreV1().Secrets(readOnlyNamespace).Delete(ctx, saName+"-token", metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete token secret: " + err.Error()})
		return
	}
	if err := cs.CoreV1().ServiceAccounts(readOnlyNamespace).Delete(ctx, saName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete ServiceAccount: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "access revoked", "service_account": saName})
}

// readOnlyClusterClient resolves the :id param to a connected cluster client,
// writing the error response itself when it cannot.
func readOnlyClusterClient(c *gin.Context) (*kubernetes.Clientset, models.Server, bool) {
	var server models.Server
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return nil, server, false
	}
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return nil, server, false
	}
	if !server.IsK8s || server.KubeConfig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "this server is not a Kubernetes-connected cluster"})
		return nil, server, false
	}
	cs, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return nil, server, false
	}
	return cs, server, true
}
