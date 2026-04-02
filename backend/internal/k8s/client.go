package k8s

import (
	"fmt"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

// GetK8sClient returns a typed Kubernetes Clientset using the raw kubeconfig.
func GetK8sClient(kubeconfig string) (*kubernetes.Clientset, error) {
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
	return kubernetes.NewForConfig(config)
}
