package k8s

import (
	"fmt"
	"strings"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metrics "k8s.io/metrics/pkg/client/clientset/versioned"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/yaml"
	"context"
)

// GetRestConfig parses and returns a rest.Config from kubeconfig string.
func GetRestConfig(kubeconfig string) (*rest.Config, error) {
	if kubeconfig == "" {
		return nil, fmt.Errorf("no kubeconfig provided on server")
	}

	apiConfig, err := clientcmd.Load([]byte(kubeconfig))
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig YAML: %v", err)
	}

	// Auto-heal missing or invalid current-context by grabbing the first available
	if _, ok := apiConfig.Contexts[apiConfig.CurrentContext]; !ok && len(apiConfig.Contexts) > 0 {
		for k := range apiConfig.Contexts {
			apiConfig.CurrentContext = k
			break
		}
	}

	clientConfig := clientcmd.NewDefaultClientConfig(*apiConfig, &clientcmd.ConfigOverrides{})
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to generate client config: %v", err)
	}
	config.QPS = 50
	config.Burst = 100
	return config, nil
}

// GetK8sClient returns a typed Kubernetes Clientset using the raw kubeconfig.
func GetK8sClient(kubeconfig string) (*kubernetes.Clientset, error) {
	config, err := GetRestConfig(kubeconfig)
	if err != nil {
		return nil, err
	}
	return kubernetes.NewForConfig(config)
}

// GetDynamicClient returns a dynamic client for generic resource operations.
func GetDynamicClient(kubeconfig string) (dynamic.Interface, error) {
	config, err := GetRestConfig(kubeconfig)
	if err != nil {
		return nil, err
	}
	return dynamic.NewForConfig(config)
}

// GetNodeMetrics returns node metrics if metrics-server is installed
func GetNodeMetrics(kubeconfig string) (*metricsv1beta1.NodeMetricsList, error) {
	if kubeconfig == "" {
		return nil, fmt.Errorf("no kubeconfig provided")
	}
	
	apiConfig, err := clientcmd.Load([]byte(kubeconfig))
	if err != nil {
		return nil, err
	}
	
	clientConfig := clientcmd.NewDefaultClientConfig(*apiConfig, &clientcmd.ConfigOverrides{})
	config, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, err
	}

	mClient, err := metrics.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return mClient.MetricsV1beta1().NodeMetricses().List(context.Background(), metav1.ListOptions{})
}

// GetNativeYaml fetches a resource using the dynamic client and returns its YAML representation.
// It explicitly restores apiVersion and kind since the K8s API server strips them from GET responses.
func GetNativeYaml(kubeconfig, group, version, resource, namespace, name string) (string, error) {
	config, err := GetRestConfig(kubeconfig)
	if err != nil {
		return "", err
	}
	dClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return "", err
	}

	gvr := schema.GroupVersionResource{
		Group:    group,
		Version:  version,
		Resource: resource,
	}

	ctx := context.Background()
	var unstrObj *unstructured.Unstructured
	if namespace != "" {
		unstrObj, err = dClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		unstrObj, err = dClient.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
	}

	if err != nil {
		return "", err
	}

	// The K8s API server strips apiVersion and kind from GET responses.
	// We must reconstruct them from the GVR — this is what `kubectl get -o yaml` does too.
	apiVersion := version
	if group != "" {
		apiVersion = group + "/" + version
	}
	// Derive Kind from resource name (singular, Title-case)
	// e.g. "pods" -> "Pod", "deployments" -> "Deployment", "daemonsets" -> "DaemonSet"
	kindMap := map[string]string{
		"pods": "Pod", "nodes": "Node", "namespaces": "Namespace",
		"services": "Service", "endpoints": "Endpoints", "ingresses": "Ingress",
		"configmaps": "ConfigMap", "secrets": "Secret", "serviceaccounts": "ServiceAccount",
		"persistentvolumes": "PersistentVolume", "persistentvolumeclaims": "PersistentVolumeClaim",
		"storageclasses": "StorageClass", "resourcequotas": "ResourceQuota",
		"deployments": "Deployment", "replicasets": "ReplicaSet", "statefulsets": "StatefulSet",
		"daemonsets": "DaemonSet", "jobs": "Job", "cronjobs": "CronJob",
		"roles": "Role", "clusterroles": "ClusterRole",
		"rolebindings": "RoleBinding", "clusterrolebindings": "ClusterRoleBinding",
		"networkpolicies": "NetworkPolicy",
		"horizontalpodautoscalers": "HorizontalPodAutoscaler",
		"events": "Event",
	}
	kind := kindMap[resource]
	if kind == "" {
		// Generic fallback: strip trailing 's' and title-case
		kind = strings.TrimSuffix(resource, "s")
		if len(kind) > 0 {
			kind = strings.ToUpper(kind[:1]) + kind[1:]
		}
	}

	unstrObj.SetAPIVersion(apiVersion)
	unstrObj.SetKind(kind)

	data, err := yaml.Marshal(unstrObj.Object)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
