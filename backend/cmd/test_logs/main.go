package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

func main() {
	db.Connect()
	var server models.Server
	db.DB.First(&server, 117)

	config, err := clientcmd.RESTConfigFromKubeConfig([]byte(server.KubeConfig))
	if err != nil {
		log.Fatal("config err:", err)
	}
	clientset, _ := kubernetes.NewForConfig(config)

	podList, err := clientset.CoreV1().Pods("").List(context.TODO(), metav1.ListOptions{})
	if err != nil || len(podList.Items) == 0 {
		log.Fatal("list pods:", err)
	}
	podName := podList.Items[0].Name
	ns := podList.Items[0].Namespace
	fmt.Printf("Fetching logs for %s/%s\n", ns, podName)

	tail := int64(10)
	req := clientset.CoreV1().Pods(ns).GetLogs(podName, &corev1.PodLogOptions{
		Follow:    true,
		TailLines: &tail,
	})

	stream, err := req.Stream(context.TODO())
	if err != nil {
		log.Fatal("Stream err:", err)
	}
	defer stream.Close()

	n, err := io.Copy(os.Stdout, stream)
	fmt.Printf("\nCopied: %d bytes. Err: %v\n", n, err)
}
