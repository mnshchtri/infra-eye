package k8s

import (
	"fmt"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metrics "k8s.io/metrics/pkg/client/clientset/versioned"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
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
