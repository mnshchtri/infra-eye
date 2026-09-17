package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
)

// The inventory pass (df/lsblk/mount) is cheap, but the analyze pass walks a
// whole subtree with du/find — on a big filesystem that legitimately takes
// minutes, so it gets a much longer leash than the networking handler's.
const (
	storageCmdTimeout  = 30 * time.Second
	storageScanTimeout = 180 * time.Second
)

// Default caps for the analyze pass. Deliberately modest: the point is "what is
// eating this path", not a full directory listing.
const (
	defaultTopN = 20
	maxTopN     = 100
)

type FilesystemInfo struct {
	Device        string  `json:"device"`
	Mountpoint    string  `json:"mountpoint"`
	FSType        string  `json:"fstype"`
	Options       string  `json:"options"`
	SizeKB        int64   `json:"size_kb"`
	UsedKB        int64   `json:"used_kb"`
	AvailKB       int64   `json:"avail_kb"`
	UsePercent    float64 `json:"use_percent"`
	InodesTotal   int64   `json:"inodes_total"`
	InodesUsed    int64   `json:"inodes_used"`
	InodesPercent float64 `json:"inodes_percent"`
}

type BlockDevice struct {
	Name       string `json:"name"`
	Size       string `json:"size"`
	Type       string `json:"type"`
	FSType     string `json:"fstype"`
	Mountpoint string `json:"mountpoint"`
	Model      string `json:"model"`
}

type StorageTotals struct {
	SizeKB     int64   `json:"size_kb"`
	UsedKB     int64   `json:"used_kb"`
	AvailKB    int64   `json:"avail_kb"`
	UsePercent float64 `json:"use_percent"`
	Mounts     int     `json:"mounts"`
}

type StorageInfo struct {
	Hostname    string           `json:"hostname"`
	Filesystems []FilesystemInfo `json:"filesystems"`
	Devices     []BlockDevice    `json:"devices"`
	Totals      StorageTotals    `json:"totals"`
	Warnings    []string         `json:"warnings"`
}

type DirUsage struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	SizeKB   int64   `json:"size_kb"`
	Percent  float64 `json:"percent"`
	Category string  `json:"category"`
}

type FileUsage struct {
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	SizeKB   int64   `json:"size_kb"`
	Percent  float64 `json:"percent"`
	Modified string  `json:"modified"`
	Owner    string  `json:"owner"`
	Category string  `json:"category"`
}

type CategoryUsage struct {
	Name    string  `json:"name"`
	SizeKB  int64   `json:"size_kb"`
	Percent float64 `json:"percent"`
	Entries int     `json:"entries"`
}

type StorageAnalysis struct {
	Path          string          `json:"path"`
	Parent        string          `json:"parent"`
	TotalKB       int64           `json:"total_kb"`
	AccountedKB   int64           `json:"accounted_kb"`
	Mountpoint    string          `json:"mountpoint"`
	Device        string          `json:"device"`
	MountSizeKB   int64           `json:"mount_size_kb"`
	MountUsedKB   int64           `json:"mount_used_kb"`
	MountAvailKB  int64           `json:"mount_avail_kb"`
	Folders       []DirUsage      `json:"folders"`
	Files         []FileUsage     `json:"files"`
	Categories    []CategoryUsage `json:"categories"`
	FileMinSizeKB int64           `json:"file_min_size_kb"`
	DurationMS    int64           `json:"duration_ms"`
	Warnings      []string        `json:"warnings"`
}

// ── Path validation ───────────────────────────────────────────────
// Analyze takes a caller-supplied path straight into a remote shell command, so
// the path is allowlisted rather than escaped: anything that could break out of
// the single quotes (quote, backslash, $, backtick, newline, ;, |, &) is
// rejected outright instead of being quoted away.

var posixPathRe = regexp.MustCompile(`^/[A-Za-z0-9 ._\-+@:/=,%]*$`)
var windowsPathRe = regexp.MustCompile(`^[A-Za-z]:\\[A-Za-z0-9 ._\-+@\\/=,%]*$`)

func validateScanPath(p, os string) (string, error) {
	p = strings.TrimSpace(p)
	if os == "windows" {
		if p == "" {
			p = `C:\`
		}
		if !windowsPathRe.MatchString(p) {
			return "", fmt.Errorf("invalid path: use an absolute Windows path (e.g. C:\\Users) without shell metacharacters")
		}
		return p, nil
	}
	if p == "" {
		p = "/"
	}
	if !posixPathRe.MatchString(p) {
		return "", fmt.Errorf("invalid path: use an absolute path without shell metacharacters")
	}
	if strings.Contains(p, "..") {
		return "", fmt.Errorf("invalid path: '..' is not allowed, pass the resolved path instead")
	}
	if p != "/" {
		p = strings.TrimRight(p, "/")
	}
	return p, nil
}

func parentPath(p, os string) string {
	if os == "windows" {
		p = strings.TrimRight(p, `\`)
		idx := strings.LastIndex(p, `\`)
		if idx <= 1 {
			return ""
		}
		return p[:idx]
	}
	if p == "/" || p == "" {
		return ""
	}
	parent := path.Dir(p)
	return parent
}

// ── Category classification ───────────────────────────────────────
// Maps a path to the kind of data that lives there, so the UI can answer "what
// *kind* of thing is eating this mount" rather than only "which directory".
// Longest matching prefix wins, so /var/lib/docker beats /var.

type categoryRule struct {
	match    string
	category string
}

var categoryRules = []categoryRule{
	{"/var/log", "Logs"},
	{"/var/lib/docker", "Containers"},
	{"/var/lib/containerd", "Containers"},
	{"/var/lib/containers", "Containers"},
	{"/var/lib/kubelet", "Containers"},
	{"/var/lib/libvirt", "VM images"},
	{"/var/lib/postgresql", "Databases"},
	{"/var/lib/mysql", "Databases"},
	{"/var/lib/mongodb", "Databases"},
	{"/var/lib/redis", "Databases"},
	{"/var/lib/elasticsearch", "Databases"},
	{"/var/lib/influxdb", "Databases"},
	{"/var/lib/prometheus", "Metrics"},
	{"/var/lib/grafana", "Metrics"},
	{"/var/cache", "Cache"},
	{"/var/spool", "Spool"},
	{"/var/backups", "Backups"},
	{"/var/tmp", "Temporary"},
	{"/var/lib", "App data"},
	{"/var", "App data"},
	{"/tmp", "Temporary"},
	{"/home", "User data"},
	{"/Users", "User data"},
	{"/root", "User data"},
	{"/srv", "Served data"},
	{"/opt", "Applications"},
	{"/Applications", "Applications"},
	{"/usr", "System"},
	{"/lib", "System"},
	{"/lib64", "System"},
	{"/bin", "System"},
	{"/sbin", "System"},
	{"/boot", "System"},
	{"/etc", "Config"},
	{"/System", "System"},
	{"/Library", "System"},
	{"/private/var/log", "Logs"},
	{"/private/var", "App data"},
	{"/private/tmp", "Temporary"},
	{"/snap", "Applications"},
	{"/mnt", "Mounted volumes"},
	{"/media", "Mounted volumes"},
	{"/data", "Served data"},
}

// Name-based rules catch the heavy hitters that live anywhere on the disk —
// a node_modules under /home is still dependencies, not user data.
var categoryNameRules = []categoryRule{
	{"node_modules", "Dependencies"},
	{".git", "VCS"},
	{"vendor", "Dependencies"},
	{".cache", "Cache"},
	{".npm", "Cache"},
	{".m2", "Dependencies"},
	{".gradle", "Dependencies"},
	{".cargo", "Dependencies"},
	{"__pycache__", "Cache"},
	{"site-packages", "Dependencies"},
	{"Library", "App data"},
	{"Downloads", "Downloads"},
	{"Photos Library.photoslibrary", "Media"},
}

var categoryExtensions = map[string]string{
	".log": "Logs", ".gz": "Archives", ".zip": "Archives", ".tar": "Archives",
	".tgz": "Archives", ".bz2": "Archives", ".xz": "Archives", ".7z": "Archives",
	".iso": "Disk images", ".img": "Disk images", ".qcow2": "VM images",
	".vmdk": "VM images", ".vdi": "VM images", ".dmg": "Disk images",
	".sql": "Databases", ".dump": "Backups", ".bak": "Backups",
	".mp4": "Media", ".mov": "Media", ".mkv": "Media", ".avi": "Media",
	".jpg": "Media", ".jpeg": "Media", ".png": "Media", ".heic": "Media",
	".db": "Databases", ".sqlite": "Databases", ".sqlite3": "Databases",
	".core": "Crash dumps", ".dmp": "Crash dumps",
}

func categorize(p, name string, isFile bool) string {
	lower := strings.ToLower(name)
	for _, r := range categoryNameRules {
		if strings.EqualFold(name, r.match) {
			return r.category
		}
	}
	if isFile {
		if ext := strings.ToLower(path.Ext(lower)); ext != "" {
			if cat, ok := categoryExtensions[ext]; ok {
				return cat
			}
		}
		// Rotated logs land as access.log.1 / syslog.2.gz — the extension
		// lookup above already claims .gz as an archive, so check the stem too.
		if strings.Contains(lower, ".log") {
			return "Logs"
		}
	}
	best := ""
	bestLen := 0
	for _, r := range categoryRules {
		if (p == r.match || strings.HasPrefix(p, r.match+"/")) && len(r.match) > bestLen {
			best, bestLen = r.category, len(r.match)
		}
	}
	if best != "" {
		return best
	}
	return "Other"
}

// ── Linux scripts ─────────────────────────────────────────────────

const linuxDFScript = `
df -P -k -T 2>/dev/null | tail -n +2 | awk '{
  dev=$1; fstype=$2; size=$3; used=$4; avail=$5; pct=$6;
  mnt=$7; for(i=8;i<=NF;i++) mnt=mnt" "$i;
  gsub(/%/,"",pct);
  if (size+0 <= 0) next;
  printf "{\"device\":\"%s\",\"fstype\":\"%s\",\"size_kb\":%s,\"used_kb\":%s,\"avail_kb\":%s,\"use_percent\":%s,\"mountpoint\":\"%s\"}\n", dev, fstype, size, used, avail, pct, mnt;
}'
`

const linuxInodeScript = `
df -P -i 2>/dev/null | tail -n +2 | awk '{
  total=$2; used=$3; pct=$5;
  mnt=$6; for(i=7;i<=NF;i++) mnt=mnt" "$i;
  gsub(/%/,"",pct);
  if (pct == "-" || pct == "") pct=0;
  printf "{\"mountpoint\":\"%s\",\"inodes_total\":%s,\"inodes_used\":%s,\"inodes_percent\":%s}\n", mnt, total+0, used+0, pct+0;
}'
`

const linuxMountOptsScript = `
mount 2>/dev/null | awk '{
  for (i=1;i<=NF;i++) if ($i == "on") { mstart=i+1; break }
  for (i=1;i<=NF;i++) if ($i == "type") { tpos=i; break }
  mnt="";
  end = (tpos > 0) ? tpos-1 : NF;
  for (i=mstart;i<=end;i++) mnt = mnt (i>mstart?" ":"") $i;
  opts="";
  for (i=1;i<=NF;i++) if ($i ~ /^\(/) { for (j=i;j<=NF;j++) opts = opts (j>i?" ":"") $j; break }
  gsub(/[()]/,"",opts);
  if (mnt != "") printf "{\"mountpoint\":\"%s\",\"options\":\"%s\"}\n", mnt, opts;
}'
`

const linuxBlockScript = `
if command -v lsblk >/dev/null 2>&1; then
  lsblk -P -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL 2>/dev/null
fi
`

// du gives directory totals; the trailing entry for the scanned path itself is
// the subtree total, which the parser pulls out to compute shares.
const linuxDirScript = `
du -x -k -d 1 '%s' 2>/dev/null | sort -rn | head -n %d | awk -F'\t' '{
  printf "{\"size_kb\":%%s,\"path\":\"%%s\"}\n", $1, $2;
}'
`

// -size +%dk prefilters before the sort so a filesystem with millions of small
// files doesn't ship (or sort) millions of lines back over SSH.
const linuxFileScript = `
find '%s' -xdev -type f -size +%dk -printf '%%s\t%%TY-%%Tm-%%Td %%TH:%%TM\t%%u\t%%p\n' 2>/dev/null | sort -rn | head -n %d | awk -F'\t' '{
  printf "{\"size_bytes\":%%s,\"modified\":\"%%s\",\"owner\":\"%%s\",\"path\":\"%%s\"}\n", $1, $2, $3, $4;
}'
`

// ── macOS (darwin) scripts ────────────────────────────────────────
// BSD df has no -T, but its default -k output already carries inode columns,
// so one pass covers both blocks and inodes; fstype comes from mount(8).

const darwinDFScript = `
df -k 2>/dev/null | tail -n +2 | awk '{
  dev=$1; size=$2; used=$3; avail=$4; pct=$5; iused=$6; ifree=$7; ipct=$8;
  mnt=$9; for(i=10;i<=NF;i++) mnt=mnt" "$i;
  gsub(/%/,"",pct); gsub(/%/,"",ipct);
  if (size+0 <= 0) next;
  itotal = iused + ifree;
  printf "{\"device\":\"%s\",\"fstype\":\"\",\"size_kb\":%s,\"used_kb\":%s,\"avail_kb\":%s,\"use_percent\":%s,\"inodes_total\":%s,\"inodes_used\":%s,\"inodes_percent\":%s,\"mountpoint\":\"%s\"}\n", dev, size, used, avail, pct, itotal, iused, ipct+0, mnt;
}'
`

const darwinMountScript = `
mount 2>/dev/null | awk '{
  for (i=1;i<=NF;i++) if ($i == "on") { mstart=i+1; break }
  opts=""; oidx=0;
  for (i=1;i<=NF;i++) if ($i ~ /^\(/) { oidx=i; break }
  end = (oidx > 0) ? oidx-1 : NF;
  mnt="";
  for (i=mstart;i<=end;i++) mnt = mnt (i>mstart?" ":"") $i;
  if (oidx > 0) for (j=oidx;j<=NF;j++) opts = opts (j>oidx?" ":"") $j;
  gsub(/[()]/,"",opts); gsub(/,$/,"",opts);
  split(opts, parts, ",");
  fstype=parts[1]; gsub(/^ +| +$/,"",fstype);
  if (mnt != "") printf "{\"mountpoint\":\"%s\",\"fstype\":\"%s\",\"options\":\"%s\"}\n", mnt, fstype, opts;
}'
`

const darwinBlockScript = `
if command -v diskutil >/dev/null 2>&1; then
  diskutil list 2>/dev/null | awk '
    /^\/dev\// { disk=$1; next }
    /^ +[0-9]+:/ {
      id=$NF;
      size=$(NF-2)" "$(NF-1);
      type=$2;
      name="";
      for (i=3;i<=NF-3;i++) name = name (i>3?" ":"") $i;
      gsub(/[*+]/,"",size);
      kind = (id ~ /^disk[0-9]+$/) ? "disk" : "part";
      printf "{\"name\":\"%s\",\"size\":\"%s\",\"type\":\"%s\",\"fstype\":\"%s\",\"mountpoint\":\"\",\"model\":\"%s\"}\n", id, size, kind, type, name;
    }'
fi
`

const darwinDirScript = `
du -x -k -d 1 '%s' 2>/dev/null | sort -rn | head -n %d | awk -F'\t' '{
  printf "{\"size_kb\":%%s,\"path\":\"%%s\"}\n", $1, $2;
}'
`

// BSD find has no -printf, so sizes come from stat(1); the -size prefilter keeps
// the number of stat invocations sane on a big tree.
const darwinFileScript = `
find '%s' -xdev -type f -size +%dk -print0 2>/dev/null | xargs -0 -n 256 stat -f '%%z	%%Sm	%%Su	%%N' -t '%%Y-%%m-%%d %%H:%%M' 2>/dev/null | sort -rn | head -n %d | awk -F'\t' '{
  printf "{\"size_bytes\":%%s,\"modified\":\"%%s\",\"owner\":\"%%s\",\"path\":\"%%s\"}\n", $1, $2, $3, $4;
}'
`

// ── Windows scripts ───────────────────────────────────────────────

const windowsDFScript = `powershell -NoProfile -NonInteractive -Command "
Get-CimInstance Win32_LogicalDisk | Where-Object { $_.Size -gt 0 } | ForEach-Object {
  $obj = [PSCustomObject]@{
    device = $_.DeviceID
    mountpoint = $_.DeviceID + '\'
    fstype = $_.FileSystem
    options = $_.VolumeName
    size_kb = [int64]($_.Size / 1024)
    used_kb = [int64](($_.Size - $_.FreeSpace) / 1024)
    avail_kb = [int64]($_.FreeSpace / 1024)
    use_percent = [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1)
  }
  $obj | ConvertTo-Json -Compress
}
"`

const windowsBlockScript = `powershell -NoProfile -NonInteractive -Command "
Get-CimInstance Win32_DiskDrive | ForEach-Object {
  $obj = [PSCustomObject]@{
    name = $_.DeviceID
    size = [string][math]::Round($_.Size / 1GB, 1) + ' GB'
    type = 'disk'
    fstype = ''
    mountpoint = ''
    model = $_.Model
  }
  $obj | ConvertTo-Json -Compress
}
"`

const windowsDirScript = `powershell -NoProfile -NonInteractive -Command "
$root = '%s'
$dirs = Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $size = (Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if (-not $size) { $size = 0 }
  [PSCustomObject]@{ size_kb = [int64]($size / 1024); path = $_.FullName }
}
$dirs | Sort-Object size_kb -Descending | Select-Object -First %d | ForEach-Object { $_ | ConvertTo-Json -Compress }
"`

const windowsFileScript = `powershell -NoProfile -NonInteractive -Command "
$root = '%s'
Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt %d } |
  Sort-Object Length -Descending | Select-Object -First %d | ForEach-Object {
    $obj = [PSCustomObject]@{
      size_bytes = $_.Length
      modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
      owner = ''
      path = $_.FullName
    }
    $obj | ConvertTo-Json -Compress
  }
"`

// ── Handlers ──────────────────────────────────────────────────────

// sshServerForStorage resolves the :id param to an SSH-reachable server and
// opens (or reuses) its pooled connection, writing the error response itself.
func sshServerForStorage(c *gin.Context) (*models.Server, *sshpool.Client, bool) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return nil, nil, false
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return nil, nil, false
	}

	if server.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "storage info requires an SSH-connected server"})
		return nil, nil, false
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("SSH connection failed: %v", err)})
		return nil, nil, false
	}
	return &server, client, true
}

// GetServerStorage returns the filesystem/block-device inventory for a server.
func GetServerStorage(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	server, client, ok := sshServerForStorage(c)
	if !ok {
		return
	}

	info := StorageInfo{Filesystems: []FilesystemInfo{}, Devices: []BlockDevice{}, Warnings: []string{}}

	hostnameCmd := "hostname -f 2>/dev/null || hostname"
	dfScript := linuxDFScript
	blockScript := linuxBlockScript

	switch server.OS {
	case "darwin":
		dfScript = darwinDFScript
		blockScript = darwinBlockScript
	case "windows":
		hostnameCmd = windowsHostnameCmd
		dfScript = windowsDFScript
		blockScript = windowsBlockScript
	}
	if server.OS != "windows" {
		hostnameCmd = sshpool.PosixCommand(hostnameCmd)
		dfScript = sshpool.PosixCommand(dfScript)
		blockScript = sshpool.PosixCommand(blockScript)
	}

	hostnameOut, _, _ := client.RunCommandTimeout(hostnameCmd, storageCmdTimeout)
	info.Hostname = strings.TrimSpace(hostnameOut)

	dfOut, _, err := client.RunCommandTimeout(dfScript, storageCmdTimeout)
	if err != nil {
		log.Printf("storage: df query failed for server %d: %v", server.ID, err)
		info.Warnings = append(info.Warnings, "filesystem list may be incomplete: "+err.Error())
	}
	info.Filesystems = parseFilesystems(dfOut)

	// Linux needs two extra passes: inodes come from df -i and the mount
	// options (ro, noexec, …) from mount(8). darwin folds both into df/mount.
	if server.OS != "windows" {
		mountScript := linuxMountOptsScript
		if server.OS == "darwin" {
			mountScript = darwinMountScript
		} else {
			inodeOut, _, err := client.RunCommandTimeout(sshpool.PosixCommand(linuxInodeScript), storageCmdTimeout)
			if err != nil {
				log.Printf("storage: inode query failed for server %d: %v", server.ID, err)
			}
			mergeInodes(info.Filesystems, inodeOut)
		}
		mountOut, _, err := client.RunCommandTimeout(sshpool.PosixCommand(mountScript), storageCmdTimeout)
		if err != nil {
			log.Printf("storage: mount query failed for server %d: %v", server.ID, err)
		}
		mergeMountInfo(info.Filesystems, mountOut)
	}

	blockOut, _, err := client.RunCommandTimeout(blockScript, storageCmdTimeout)
	if err != nil {
		log.Printf("storage: block device query failed for server %d: %v", server.ID, err)
	}
	if server.OS == "windows" || server.OS == "darwin" {
		info.Devices = parseJSONLines[BlockDevice](blockOut)
	} else {
		info.Devices = parseLsblk(blockOut)
	}

	info.Totals = computeTotals(info.Filesystems)
	sort.SliceStable(info.Filesystems, func(i, j int) bool {
		return info.Filesystems[i].UsedKB > info.Filesystems[j].UsedKB
	})

	c.JSON(http.StatusOK, info)
}

// AnalyzeServerStorage walks one path and reports what is consuming it: the
// biggest child directories, the biggest files, and a rollup by data category.
func AnalyzeServerStorage(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	server, client, ok := sshServerForStorage(c)
	if !ok {
		return
	}

	scanPath, err := validateScanPath(c.Query("path"), server.OS)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	limit := defaultTopN
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > maxTopN {
		limit = maxTopN
	}

	// Files smaller than this are ignored by the "largest files" pass — the
	// prefilter is what keeps the remote find/sort affordable on a big tree.
	minFileKB := int64(1024)
	if v, err := strconv.ParseInt(c.Query("min_file_kb"), 10, 64); err == nil && v >= 0 {
		minFileKB = v
	}

	started := time.Now()
	analysis := StorageAnalysis{
		Path:          scanPath,
		Parent:        parentPath(scanPath, server.OS),
		Folders:       []DirUsage{},
		Files:         []FileUsage{},
		Categories:    []CategoryUsage{},
		FileMinSizeKB: minFileKB,
		Warnings:      []string{},
	}

	var dirCmd, fileCmd string
	switch server.OS {
	case "darwin":
		dirCmd = sshpool.PosixCommand(fmt.Sprintf(darwinDirScript, scanPath, limit+1))
		fileCmd = sshpool.PosixCommand(fmt.Sprintf(darwinFileScript, scanPath, minFileKB, limit))
	case "windows":
		dirCmd = fmt.Sprintf(windowsDirScript, scanPath, limit)
		fileCmd = fmt.Sprintf(windowsFileScript, scanPath, minFileKB*1024, limit)
	default:
		dirCmd = sshpool.PosixCommand(fmt.Sprintf(linuxDirScript, scanPath, limit+1))
		fileCmd = sshpool.PosixCommand(fmt.Sprintf(linuxFileScript, scanPath, minFileKB, limit))
	}

	// Which filesystem this path actually lives on — the answer to "which mount
	// is this path consuming".
	if server.OS != "windows" {
		dfCmd := sshpool.PosixCommand(fmt.Sprintf(`df -P -k '%s' 2>/dev/null | tail -n 1`, scanPath))
		if out, _, err := client.RunCommandTimeout(dfCmd, storageCmdTimeout); err == nil {
			fields := strings.Fields(strings.TrimSpace(out))
			if len(fields) >= 6 {
				analysis.Device = fields[0]
				analysis.MountSizeKB = parseInt64(fields[1])
				analysis.MountUsedKB = parseInt64(fields[2])
				analysis.MountAvailKB = parseInt64(fields[3])
				analysis.Mountpoint = strings.Join(fields[5:], " ")
			}
		}
	}

	dirOut, _, err := client.RunCommandTimeout(dirCmd, storageScanTimeout)
	if err != nil {
		log.Printf("storage: directory scan failed for server %d path %s: %v", server.ID, scanPath, err)
		analysis.Warnings = append(analysis.Warnings, "directory scan did not finish: "+err.Error())
	}
	analysis.Folders, analysis.TotalKB = parseDirUsage(dirOut, scanPath, limit)

	fileOut, _, err := client.RunCommandTimeout(fileCmd, storageScanTimeout)
	if err != nil {
		log.Printf("storage: file scan failed for server %d path %s: %v", server.ID, scanPath, err)
		analysis.Warnings = append(analysis.Warnings, "file scan did not finish: "+err.Error())
	}
	analysis.Files = parseFileUsage(fileOut, limit)

	// Percentages are shares of the scanned subtree; fall back to the sum of
	// what was found when du couldn't report a total for the path itself.
	if analysis.TotalKB == 0 {
		for _, f := range analysis.Folders {
			analysis.TotalKB += f.SizeKB
		}
	}
	for i := range analysis.Folders {
		analysis.AccountedKB += analysis.Folders[i].SizeKB
		if analysis.TotalKB > 0 {
			analysis.Folders[i].Percent = float64(analysis.Folders[i].SizeKB) / float64(analysis.TotalKB) * 100
		}
	}
	for i := range analysis.Files {
		if analysis.TotalKB > 0 {
			analysis.Files[i].Percent = float64(analysis.Files[i].SizeKB) / float64(analysis.TotalKB) * 100
		}
	}

	analysis.Categories = rollupCategories(analysis.Folders, analysis.TotalKB)
	analysis.DurationMS = time.Since(started).Milliseconds()

	if len(analysis.Folders) == 0 && len(analysis.Files) == 0 && len(analysis.Warnings) == 0 {
		analysis.Warnings = append(analysis.Warnings, "nothing readable found under this path — it may be empty or the SSH user may lack permission to read it")
	}

	c.JSON(http.StatusOK, analysis)
}

// ── Parsers ───────────────────────────────────────────────────────

// parseJSONLines decodes the newline-delimited JSON the remote scripts emit,
// skipping anything that isn't a complete object (tool banners, stray stderr).
func parseJSONLines[T any](output string) []T {
	items := []T{}
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] != '{' {
			continue
		}
		var item T
		if err := json.Unmarshal([]byte(line), &item); err == nil {
			items = append(items, item)
		}
	}
	return items
}

// baseName is path.Base that also understands Windows separators, since the
// same parsers handle output from PowerShell hosts.
func baseName(p string) string {
	if idx := strings.LastIndex(p, `\`); idx >= 0 {
		return p[idx+1:]
	}
	return path.Base(p)
}

func parseInt64(s string) int64 {
	v, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return 0
	}
	return v
}

var pseudoFS = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true, "securityfs": true,
	"cgroup": true, "cgroup2": true, "pstore": true, "bpf": true, "autofs": true,
	"mqueue": true, "hugetlbfs": true, "debugfs": true, "tracefs": true, "fusectl": true,
	"configfs": true, "binfmt_misc": true, "nsfs": true, "ramfs": true, "squashfs": true,
	"devfs": true, "map": true,
}

func parseFilesystems(output string) []FilesystemInfo {
	raw := parseJSONLines[FilesystemInfo](output)
	out := make([]FilesystemInfo, 0, len(raw))
	for _, fs := range raw {
		if fs.SizeKB <= 0 || pseudoFS[fs.FSType] {
			continue
		}
		// Kernel bookkeeping mounts carry real sizes on some systems but say
		// nothing about user-visible capacity.
		if strings.HasPrefix(fs.Mountpoint, "/proc") || strings.HasPrefix(fs.Mountpoint, "/sys") ||
			strings.HasPrefix(fs.Mountpoint, "/dev/") || fs.Mountpoint == "/dev" {
			continue
		}
		out = append(out, fs)
	}
	return out
}

func mergeInodes(fss []FilesystemInfo, output string) {
	byMount := map[string]FilesystemInfo{}
	for _, in := range parseJSONLines[FilesystemInfo](output) {
		byMount[in.Mountpoint] = in
	}
	for i := range fss {
		if in, ok := byMount[fss[i].Mountpoint]; ok {
			fss[i].InodesTotal = in.InodesTotal
			fss[i].InodesUsed = in.InodesUsed
			fss[i].InodesPercent = in.InodesPercent
		}
	}
}

func mergeMountInfo(fss []FilesystemInfo, output string) {
	byMount := map[string]FilesystemInfo{}
	for _, m := range parseJSONLines[FilesystemInfo](output) {
		byMount[m.Mountpoint] = m
	}
	for i := range fss {
		m, ok := byMount[fss[i].Mountpoint]
		if !ok {
			continue
		}
		fss[i].Options = m.Options
		if fss[i].FSType == "" {
			fss[i].FSType = m.FSType
		}
	}
}

// parseLsblk reads lsblk's -P (key="value") pair format.
func parseLsblk(output string) []BlockDevice {
	devices := []BlockDevice{}
	fieldRe := regexp.MustCompile(`([A-Z]+)="([^"]*)"`)
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "=") {
			continue
		}
		d := BlockDevice{}
		for _, m := range fieldRe.FindAllStringSubmatch(line, -1) {
			switch m[1] {
			case "NAME":
				d.Name = m[2]
			case "SIZE":
				d.Size = m[2]
			case "TYPE":
				d.Type = m[2]
			case "FSTYPE":
				d.FSType = m[2]
			case "MOUNTPOINT":
				d.Mountpoint = m[2]
			case "MODEL":
				d.Model = strings.TrimSpace(m[2])
			}
		}
		if d.Name != "" && d.Type != "loop" {
			devices = append(devices, d)
		}
	}
	return devices
}

type rawDirEntry struct {
	SizeKB int64  `json:"size_kb"`
	Path   string `json:"path"`
}

// parseDirUsage splits du's output into children plus the subtree total, which
// du reports as the entry for the scanned path itself.
func parseDirUsage(output, scanPath string, limit int) ([]DirUsage, int64) {
	entries := parseJSONLines[rawDirEntry](output)
	dirs := []DirUsage{}
	var total int64
	normalized := strings.TrimRight(scanPath, "/")
	for _, e := range entries {
		p := strings.TrimRight(e.Path, "/")
		if p == normalized || p == scanPath || p == "." {
			total = e.SizeKB
			continue
		}
		if len(dirs) >= limit {
			continue
		}
		name := baseName(e.Path)
		dirs = append(dirs, DirUsage{
			Name:     name,
			Path:     e.Path,
			SizeKB:   e.SizeKB,
			Category: categorize(e.Path, name, false),
		})
	}
	sort.SliceStable(dirs, func(i, j int) bool { return dirs[i].SizeKB > dirs[j].SizeKB })
	return dirs, total
}

type rawFileEntry struct {
	SizeBytes int64  `json:"size_bytes"`
	Modified  string `json:"modified"`
	Owner     string `json:"owner"`
	Path      string `json:"path"`
}

func parseFileUsage(output string, limit int) []FileUsage {
	entries := parseJSONLines[rawFileEntry](output)
	files := make([]FileUsage, 0, len(entries))
	for _, e := range entries {
		if e.Path == "" {
			continue
		}
		name := baseName(e.Path)
		files = append(files, FileUsage{
			Name:     name,
			Path:     e.Path,
			SizeKB:   e.SizeBytes / 1024,
			Modified: strings.TrimSpace(e.Modified),
			Owner:    e.Owner,
			Category: categorize(e.Path, name, true),
		})
	}
	sort.SliceStable(files, func(i, j int) bool { return files[i].SizeKB > files[j].SizeKB })
	if len(files) > limit {
		files = files[:limit]
	}
	return files
}

func rollupCategories(dirs []DirUsage, total int64) []CategoryUsage {
	byName := map[string]*CategoryUsage{}
	for _, d := range dirs {
		cat, ok := byName[d.Category]
		if !ok {
			cat = &CategoryUsage{Name: d.Category}
			byName[d.Category] = cat
		}
		cat.SizeKB += d.SizeKB
		cat.Entries++
	}
	out := make([]CategoryUsage, 0, len(byName))
	for _, cat := range byName {
		if total > 0 {
			cat.Percent = float64(cat.SizeKB) / float64(total) * 100
		}
		out = append(out, *cat)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].SizeKB > out[j].SizeKB })
	return out
}

// computeTotals sums capacity without counting the same physical storage twice.
//
// A pooled filesystem (APFS containers, btrfs subvolumes) mounts several
// volumes that each report the *pool's* size and free space, so a plain sum
// turns one 245 GB Mac disk into a 1.4 TB fleet. Volumes are therefore grouped
// by their identical (size, avail) signature, counted once, and their used
// space derived as size-avail — which is the pool's real consumption. A
// standalone filesystem is a group of one and keeps df's own used figure,
// since size-avail there would wrongly include root-reserved blocks.
func computeTotals(fss []FilesystemInfo) StorageTotals {
	totals := StorageTotals{Mounts: len(fss)}
	groups := map[string][]FilesystemInfo{}
	order := []string{}
	for _, fs := range fss {
		key := fmt.Sprintf("%d|%d", fs.SizeKB, fs.AvailKB)
		if _, ok := groups[key]; !ok {
			order = append(order, key)
		}
		groups[key] = append(groups[key], fs)
	}
	for _, key := range order {
		group := groups[key]
		head := group[0]
		totals.SizeKB += head.SizeKB
		totals.AvailKB += head.AvailKB
		if len(group) > 1 {
			totals.UsedKB += head.SizeKB - head.AvailKB
		} else {
			totals.UsedKB += head.UsedKB
		}
	}
	if totals.SizeKB > 0 {
		totals.UsePercent = float64(totals.UsedKB) / float64(totals.SizeKB) * 100
	}
	return totals
}
