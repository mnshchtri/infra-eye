package handlers

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type K8sStorageClassInfo struct {
	Name          string `json:"name"`
	Provisioner   string `json:"provisioner"`
	ReclaimPolicy string `json:"reclaim_policy"`
	BindingMode   string `json:"binding_mode"`
	AllowExpand   bool   `json:"allow_expansion"`
	IsDefault     bool   `json:"is_default"`
}

type K8sPVInfo struct {
	Name          string `json:"name"`
	CapacityBytes int64  `json:"capacity_bytes"`
	AccessModes   string `json:"access_modes"`
	ReclaimPolicy string `json:"reclaim_policy"`
	Status        string `json:"status"`
	Claim         string `json:"claim"`
	StorageClass  string `json:"storage_class"`
	SourceType    string `json:"source_type"`
	Node          string `json:"node"`
}

type K8sPVCInfo struct {
	Name          string `json:"name"`
	Namespace     string `json:"namespace"`
	Status        string `json:"status"`
	Volume        string `json:"volume"`
	CapacityBytes int64  `json:"capacity_bytes"`
	RequestBytes  int64  `json:"request_bytes"`
	StorageClass  string `json:"storage_class"`
	AccessModes   string `json:"access_modes"`
	UsedBy        string `json:"used_by"`
}

type K8sNodeStorageInfo struct {
	Name             string `json:"name"`
	EphemeralTotal   int64  `json:"ephemeral_total_bytes"`
	EphemeralAlloc   int64  `json:"ephemeral_allocatable_bytes"`
	DiskPressure     bool   `json:"disk_pressure"`
	Ready            bool   `json:"ready"`
	AttachedVolumes  int    `json:"attached_volumes"`
	ContainerRuntime string `json:"container_runtime"`
}

type K8sStorageSummary struct {
	StorageClasses int   `json:"storage_classes"`
	PVs            int   `json:"pvs"`
	PVCs           int   `json:"pvcs"`
	BoundPVCs      int   `json:"bound_pvcs"`
	PendingPVCs    int   `json:"pending_pvcs"`
	Nodes          int   `json:"nodes"`
	ProvisionedB   int64 `json:"provisioned_bytes"`
	UnboundB       int64 `json:"unbound_bytes"`
	EphemeralB     int64 `json:"ephemeral_total_bytes"`
}

// K8sCategoryUsage rolls provisioned capacity up by StorageClass, so a cluster
// operator sees which tier of storage the cluster is actually paying for.
type K8sCategoryUsage struct {
	Name      string  `json:"name"`
	SizeBytes int64   `json:"size_bytes"`
	Percent   float64 `json:"percent"`
	Entries   int     `json:"entries"`
}

type K8sStorageInfo struct {
	StorageClasses []K8sStorageClassInfo `json:"storage_classes"`
	PVs            []K8sPVInfo           `json:"pvs"`
	PVCs           []K8sPVCInfo          `json:"pvcs"`
	Nodes          []K8sNodeStorageInfo  `json:"nodes"`
	ByClass        []K8sCategoryUsage    `json:"by_class"`
	ByNamespace    []K8sCategoryUsage    `json:"by_namespace"`
	Summary        K8sStorageSummary     `json:"summary"`
}

// pvSourceType names the backing driver of a PV — csi, hostPath, nfs, … — which
// is the cluster-side answer to "what is actually holding this data".
func pvSourceType(src corev1.PersistentVolumeSource) string {
	switch {
	case src.CSI != nil:
		return src.CSI.Driver
	case src.HostPath != nil:
		return "hostPath"
	case src.NFS != nil:
		return "nfs"
	case src.Local != nil:
		return "local"
	case src.ISCSI != nil:
		return "iscsi"
	case src.RBD != nil:
		return "rbd"
	case src.CephFS != nil:
		return "cephfs"
	case src.AWSElasticBlockStore != nil:
		return "aws-ebs"
	case src.GCEPersistentDisk != nil:
		return "gce-pd"
	case src.AzureDisk != nil:
		return "azure-disk"
	case src.AzureFile != nil:
		return "azure-file"
	case src.FC != nil:
		return "fc"
	case src.Glusterfs != nil:
		return "glusterfs"
	default:
		return "unknown"
	}
}

func joinAccessModes(modes []corev1.PersistentVolumeAccessMode) string {
	short := make([]string, 0, len(modes))
	for _, m := range modes {
		switch m {
		case corev1.ReadWriteOnce:
			short = append(short, "RWO")
		case corev1.ReadOnlyMany:
			short = append(short, "ROX")
		case corev1.ReadWriteMany:
			short = append(short, "RWX")
		case corev1.ReadWriteOncePod:
			short = append(short, "RWOP")
		default:
			short = append(short, string(m))
		}
	}
	return strings.Join(short, ",")
}

// GetK8sStorage reports cluster storage: classes, volumes, claims and per-node
// ephemeral capacity. The SSH-based storage view has no meaning for a cluster,
// so is_k8s servers get this instead.
func GetK8sStorage(c *gin.Context) {
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "storage info requires a Kubernetes-connected cluster"})
		return
	}

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return
	}

	ctx := context.Background()
	info := K8sStorageInfo{
		StorageClasses: []K8sStorageClassInfo{},
		PVs:            []K8sPVInfo{},
		PVCs:           []K8sPVCInfo{},
		Nodes:          []K8sNodeStorageInfo{},
		ByClass:        []K8sCategoryUsage{},
		ByNamespace:    []K8sCategoryUsage{},
	}

	// ── Storage classes ──
	if scList, err := clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{}); err == nil {
		for _, sc := range scList.Items {
			entry := K8sStorageClassInfo{
				Name:        sc.Name,
				Provisioner: sc.Provisioner,
				IsDefault:   sc.Annotations["storageclass.kubernetes.io/is-default-class"] == "true",
			}
			if sc.ReclaimPolicy != nil {
				entry.ReclaimPolicy = string(*sc.ReclaimPolicy)
			}
			if sc.VolumeBindingMode != nil {
				entry.BindingMode = string(*sc.VolumeBindingMode)
			}
			if sc.AllowVolumeExpansion != nil {
				entry.AllowExpand = *sc.AllowVolumeExpansion
			}
			info.StorageClasses = append(info.StorageClasses, entry)
		}
	}

	// ── Persistent volumes ──
	// Node affinity is where a local/topology-bound PV records which node holds
	// the bytes, so pull the first matching node name out of it.
	if pvList, err := clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{}); err == nil {
		for _, pv := range pvList.Items {
			entry := K8sPVInfo{
				Name:          pv.Name,
				AccessModes:   joinAccessModes(pv.Spec.AccessModes),
				ReclaimPolicy: string(pv.Spec.PersistentVolumeReclaimPolicy),
				Status:        string(pv.Status.Phase),
				StorageClass:  pv.Spec.StorageClassName,
				SourceType:    pvSourceType(pv.Spec.PersistentVolumeSource),
			}
			if cap, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
				entry.CapacityBytes = cap.Value()
			}
			if pv.Spec.ClaimRef != nil {
				entry.Claim = pv.Spec.ClaimRef.Namespace + "/" + pv.Spec.ClaimRef.Name
			}
			if pv.Spec.NodeAffinity != nil && pv.Spec.NodeAffinity.Required != nil {
				for _, term := range pv.Spec.NodeAffinity.Required.NodeSelectorTerms {
					for _, expr := range term.MatchExpressions {
						if expr.Key == "kubernetes.io/hostname" && len(expr.Values) > 0 {
							entry.Node = expr.Values[0]
						}
					}
				}
			}
			info.PVs = append(info.PVs, entry)
		}
	}

	// ── Claims ──
	if pvcList, err := clientset.CoreV1().PersistentVolumeClaims("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, pvc := range pvcList.Items {
			entry := K8sPVCInfo{
				Name:        pvc.Name,
				Namespace:   pvc.Namespace,
				Status:      string(pvc.Status.Phase),
				Volume:      pvc.Spec.VolumeName,
				AccessModes: joinAccessModes(pvc.Spec.AccessModes),
			}
			if pvc.Spec.StorageClassName != nil {
				entry.StorageClass = *pvc.Spec.StorageClassName
			}
			if req, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
				entry.RequestBytes = req.Value()
			}
			if cap, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
				entry.CapacityBytes = cap.Value()
			}
			info.PVCs = append(info.PVCs, entry)
		}
	}

	// ── Which workloads mount which claim ──
	// Listing pods once and indexing by claim is far cheaper than describing
	// each PVC, and it turns "40Gi bound" into "40Gi held by postgres-0".
	claimUsers := map[string][]string{}
	if podList, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); err == nil {
		for _, pod := range podList.Items {
			for _, vol := range pod.Spec.Volumes {
				if vol.PersistentVolumeClaim == nil {
					continue
				}
				key := pod.Namespace + "/" + vol.PersistentVolumeClaim.ClaimName
				claimUsers[key] = append(claimUsers[key], pod.Name)
			}
		}
	}
	for i := range info.PVCs {
		if users, ok := claimUsers[info.PVCs[i].Namespace+"/"+info.PVCs[i].Name]; ok {
			if len(users) > 3 {
				info.PVCs[i].UsedBy = strings.Join(users[:3], ", ") + " +" + strconv.Itoa(len(users)-3)
			} else {
				info.PVCs[i].UsedBy = strings.Join(users, ", ")
			}
		}
	}

	// ── Node ephemeral storage ──
	if nodeList, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{}); err == nil {
		for _, n := range nodeList.Items {
			entry := K8sNodeStorageInfo{
				Name:             n.Name,
				AttachedVolumes:  len(n.Status.VolumesInUse),
				ContainerRuntime: n.Status.NodeInfo.ContainerRuntimeVersion,
			}
			if cap, ok := n.Status.Capacity[corev1.ResourceEphemeralStorage]; ok {
				entry.EphemeralTotal = cap.Value()
			}
			if alloc, ok := n.Status.Allocatable[corev1.ResourceEphemeralStorage]; ok {
				entry.EphemeralAlloc = alloc.Value()
			}
			for _, cond := range n.Status.Conditions {
				switch cond.Type {
				case corev1.NodeReady:
					entry.Ready = cond.Status == corev1.ConditionTrue
				case corev1.NodeDiskPressure:
					entry.DiskPressure = cond.Status == corev1.ConditionTrue
				}
			}
			info.EphemeralAdd(entry)
		}
	}

	// ── Summary + rollups ──
	byClass := map[string]*K8sCategoryUsage{}
	for _, pv := range info.PVs {
		info.Summary.ProvisionedB += pv.CapacityBytes
		if pv.Claim == "" || pv.Status == string(corev1.VolumeAvailable) || pv.Status == string(corev1.VolumeReleased) {
			info.Summary.UnboundB += pv.CapacityBytes
		}
		name := pv.StorageClass
		if name == "" {
			name = "(no class)"
		}
		if _, ok := byClass[name]; !ok {
			byClass[name] = &K8sCategoryUsage{Name: name}
		}
		byClass[name].SizeBytes += pv.CapacityBytes
		byClass[name].Entries++
	}

	byNS := map[string]*K8sCategoryUsage{}
	for _, pvc := range info.PVCs {
		switch pvc.Status {
		case string(corev1.ClaimBound):
			info.Summary.BoundPVCs++
		case string(corev1.ClaimPending):
			info.Summary.PendingPVCs++
		}
		size := pvc.CapacityBytes
		if size == 0 {
			size = pvc.RequestBytes
		}
		if _, ok := byNS[pvc.Namespace]; !ok {
			byNS[pvc.Namespace] = &K8sCategoryUsage{Name: pvc.Namespace}
		}
		byNS[pvc.Namespace].SizeBytes += size
		byNS[pvc.Namespace].Entries++
	}

	info.ByClass = flattenUsage(byClass, info.Summary.ProvisionedB)
	var nsTotal int64
	for _, u := range byNS {
		nsTotal += u.SizeBytes
	}
	info.ByNamespace = flattenUsage(byNS, nsTotal)

	info.Summary.StorageClasses = len(info.StorageClasses)
	info.Summary.PVs = len(info.PVs)
	info.Summary.PVCs = len(info.PVCs)
	info.Summary.Nodes = len(info.Nodes)

	sort.SliceStable(info.PVs, func(i, j int) bool { return info.PVs[i].CapacityBytes > info.PVs[j].CapacityBytes })
	sort.SliceStable(info.PVCs, func(i, j int) bool {
		a, b := info.PVCs[i].CapacityBytes, info.PVCs[j].CapacityBytes
		if a == 0 {
			a = info.PVCs[i].RequestBytes
		}
		if b == 0 {
			b = info.PVCs[j].RequestBytes
		}
		return a > b
	})

	c.JSON(http.StatusOK, info)
}

// EphemeralAdd appends a node and folds its ephemeral capacity into the summary.
func (info *K8sStorageInfo) EphemeralAdd(n K8sNodeStorageInfo) {
	info.Nodes = append(info.Nodes, n)
	info.Summary.EphemeralB += n.EphemeralTotal
}

func flattenUsage(src map[string]*K8sCategoryUsage, total int64) []K8sCategoryUsage {
	out := make([]K8sCategoryUsage, 0, len(src))
	for _, u := range src {
		if total > 0 {
			u.Percent = float64(u.SizeBytes) / float64(total) * 100
		}
		out = append(out, *u)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SizeBytes > out[j].SizeBytes })
	return out
}
