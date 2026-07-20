package handlers

import (
	"bufio"
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
)

// Cluster log source IDs are structured:
//   events | warnings                      — cluster event stream
//   node:<name>                            — events scoped to one node
//   workload:<deploy|ds|sts>:<ns>:<name>   — merged pod logs of a workload
//   service:<ns>:<name>                    — merged pod logs behind a service
//   pod:<ns>:<name>                        — logs of a single pod (all containers)

const (
	maxSourcesPerKind = 200 // cap workloads/services listed as sources
	maxPodSources     = 400 // cap pods listed as sources
	maxMergedPods     = 10  // cap pods tailed at once for a workload/service
)

func isK8sLogSource(source string) bool {
	return source == "events" || source == "warnings" ||
		strings.HasPrefix(source, "node:") ||
		strings.HasPrefix(source, "workload:") ||
		strings.HasPrefix(source, "service:") ||
		strings.HasPrefix(source, "pod:")
}

// buildK8sLogSources discovers everything streamable in the cluster: the event
// stream, per-node events, and pod logs for every workload, service, and pod.
// Discovery failures degrade to the always-available event sources.
func buildK8sLogSources(server models.Server) []LogSource {
	sources := []LogSource{
		{ID: "events", Label: "Cluster Events (all)", Group: "Cluster"},
		{ID: "warnings", Label: "Warnings only", Group: "Cluster"},
	}
	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		return sources
	}
	ctx := context.TODO()

	if nodes, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); err == nil {
		for _, n := range nodes.Items {
			sources = append(sources, LogSource{ID: "node:" + n.Name, Label: n.Name, Group: "Node events"})
		}
	}

	if deps, err := clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{Limit: maxSourcesPerKind}); err == nil {
		for _, d := range deps.Items {
			sources = append(sources, LogSource{ID: fmt.Sprintf("workload:deploy:%s:%s", d.Namespace, d.Name), Label: d.Namespace + "/" + d.Name, Group: "Deployments"})
		}
	}
	if dss, err := clientset.AppsV1().DaemonSets("").List(ctx, metav1.ListOptions{Limit: maxSourcesPerKind}); err == nil {
		for _, d := range dss.Items {
			sources = append(sources, LogSource{ID: fmt.Sprintf("workload:ds:%s:%s", d.Namespace, d.Name), Label: d.Namespace + "/" + d.Name, Group: "DaemonSets"})
		}
	}
	if stss, err := clientset.AppsV1().StatefulSets("").List(ctx, metav1.ListOptions{Limit: maxSourcesPerKind}); err == nil {
		for _, s := range stss.Items {
			sources = append(sources, LogSource{ID: fmt.Sprintf("workload:sts:%s:%s", s.Namespace, s.Name), Label: s.Namespace + "/" + s.Name, Group: "StatefulSets"})
		}
	}
	if svcs, err := clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{Limit: maxSourcesPerKind}); err == nil {
		for _, s := range svcs.Items {
			if len(s.Spec.Selector) == 0 {
				continue // no selector → no pods to tail (e.g. the apiserver service)
			}
			sources = append(sources, LogSource{ID: fmt.Sprintf("service:%s:%s", s.Namespace, s.Name), Label: s.Namespace + "/" + s.Name, Group: "Services"})
		}
	}
	if pods, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{Limit: maxPodSources}); err == nil {
		items := pods.Items
		sort.Slice(items, func(i, j int) bool {
			if items[i].Namespace != items[j].Namespace {
				return items[i].Namespace < items[j].Namespace
			}
			return items[i].Name < items[j].Name
		})
		for _, p := range items {
			sources = append(sources, LogSource{ID: fmt.Sprintf("pod:%s:%s", p.Namespace, p.Name), Label: p.Name, Group: "Pods · " + p.Namespace})
		}
	}
	return sources
}

func broadcastLogLine(room string, serverID uint, stream, level, msg string) {
	ws.GlobalHub.Broadcast(room, "log", models.LogEntry{
		ServerID:  serverID,
		Timestamp: time.Now(),
		Stream:    stream,
		Level:     level,
		Message:   msg,
	})
}

// streamK8sPodLogs resolves the pods behind a pod/workload/service source and
// follows their container logs, merged into one stream. Lines are broadcast
// live but not persisted — a busy pod would flood the logs table.
func streamK8sPodLogs(server models.Server, room, source string, stop <-chan struct{}) {
	clientset, err := k8s.GetK8sClientForStreaming(server.KubeConfig)
	if err != nil {
		broadcastLogLine(room, server.ID, source, "error", "cluster connection failed: "+err.Error())
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { <-stop; cancel() }()

	type podRef struct{ ns, name string }
	var pods []podRef

	parts := strings.Split(source, ":")
	switch parts[0] {
	case "pod":
		if len(parts) == 3 {
			pods = append(pods, podRef{parts[1], parts[2]})
		}
	case "workload":
		if len(parts) == 4 {
			sel, err := workloadSelector(ctx, clientset, parts[1], parts[2], parts[3])
			if err != nil {
				broadcastLogLine(room, server.ID, source, "error", "failed to resolve workload: "+err.Error())
				return
			}
			for _, p := range listPodsBySelector(ctx, clientset, parts[2], sel) {
				pods = append(pods, podRef{parts[2], p})
			}
		}
	case "service":
		if len(parts) == 3 {
			svc, err := clientset.CoreV1().Services(parts[1]).Get(ctx, parts[2], metav1.GetOptions{})
			if err != nil {
				broadcastLogLine(room, server.ID, source, "error", "failed to get service: "+err.Error())
				return
			}
			if len(svc.Spec.Selector) == 0 {
				broadcastLogLine(room, server.ID, source, "warn", "service has no pod selector — nothing to tail")
				return
			}
			for _, p := range listPodsBySelector(ctx, clientset, parts[1], labels.Set(svc.Spec.Selector).String()) {
				pods = append(pods, podRef{parts[1], p})
			}
		}
	}

	if len(pods) == 0 {
		broadcastLogLine(room, server.ID, source, "warn", "no pods found for this source — the workload may be scaled to zero")
		return
	}
	if len(pods) > maxMergedPods {
		broadcastLogLine(room, server.ID, source, "info", fmt.Sprintf("tailing first %d of %d pods", maxMergedPods, len(pods)))
		pods = pods[:maxMergedPods]
	}
	multiPod := len(pods) > 1

	for _, p := range pods {
		podObj, err := clientset.CoreV1().Pods(p.ns).Get(ctx, p.name, metav1.GetOptions{})
		if err != nil {
			broadcastLogLine(room, server.ID, source, "error", fmt.Sprintf("pod %s/%s: %v", p.ns, p.name, err))
			continue
		}
		prefixed := multiPod || len(podObj.Spec.Containers) > 1
		for _, ctr := range podObj.Spec.Containers {
			go tailContainerLogs(ctx, clientset, server.ID, room, source, p.ns, p.name, ctr.Name, prefixed)
		}
	}

	<-ctx.Done()
}

func workloadSelector(ctx context.Context, cs *kubernetes.Clientset, kind, ns, name string) (string, error) {
	var sel *metav1.LabelSelector
	switch kind {
	case "deploy":
		d, err := cs.AppsV1().Deployments(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		sel = d.Spec.Selector
	case "ds":
		d, err := cs.AppsV1().DaemonSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		sel = d.Spec.Selector
	case "sts":
		s, err := cs.AppsV1().StatefulSets(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		sel = s.Spec.Selector
	default:
		return "", fmt.Errorf("unknown workload kind %q", kind)
	}
	selector, err := metav1.LabelSelectorAsSelector(sel)
	if err != nil {
		return "", err
	}
	return selector.String(), nil
}

func listPodsBySelector(ctx context.Context, cs *kubernetes.Clientset, ns, selector string) []string {
	list, err := cs.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector, Limit: 50})
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(list.Items))
	for _, p := range list.Items {
		names = append(names, p.Name)
	}
	return names
}

// tailContainerLogs follows one container's log stream until ctx is cancelled
// (client disconnected / source switched).
func tailContainerLogs(ctx context.Context, cs *kubernetes.Clientset, serverID uint, room, source, ns, pod, container string, prefixed bool) {
	tail := int64(50)
	req := cs.CoreV1().Pods(ns).GetLogs(pod, &corev1.PodLogOptions{
		Container:  container,
		Follow:     true,
		TailLines:  &tail,
		Timestamps: true,
	})
	rc, err := req.Stream(ctx)
	if err != nil {
		broadcastLogLine(room, serverID, source, "error", fmt.Sprintf("cannot stream %s/%s [%s]: %v", ns, pod, container, err))
		return
	}
	defer rc.Close()

	prefix := ""
	if prefixed {
		prefix = fmt.Sprintf("[%s/%s] ", pod, container)
	}

	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		ts := time.Now()
		// PodLogOptions.Timestamps prefixes each line with RFC3339Nano + space.
		if sp := strings.IndexByte(line, ' '); sp > 0 {
			if t, err := time.Parse(time.RFC3339Nano, line[:sp]); err == nil {
				ts = t
				line = line[sp+1:]
			}
		}
		ws.GlobalHub.Broadcast(room, "log", models.LogEntry{
			ServerID:  serverID,
			Timestamp: ts,
			Stream:    source,
			Level:     detectLevel(line),
			Message:   prefix + line,
			Source:    pod,
		})
	}
}
