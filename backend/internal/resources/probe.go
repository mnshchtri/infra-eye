package resources

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/minio/madmin-go/v3"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"

	"github.com/infra-eye/backend/internal/models"
)

// ProbeResult is a single observability snapshot for a resource: liveness plus
// a bag of type-specific gauges the frontend renders generically.
type ProbeResult struct {
	Status    string                 `json:"status"` // online | degraded | offline
	LatencyMs float64                `json:"latency_ms"`
	Error     string                 `json:"error,omitempty"`
	Metrics   map[string]interface{} `json:"metrics"`
}

const probeTimeout = 8 * time.Second

// Probe inspects a resource using the most specific method available for its
// protocol, falling back to a plain TCP/HTTP reachability check. It never
// panics and always returns a result (offline on any failure).
func Probe(ctx context.Context, r models.Resource) ProbeResult {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	proto := strings.ToLower(strings.TrimSpace(r.Protocol))
	start := time.Now()

	switch proto {
	case "postgres", "postgresql":
		return finalize(start, probePostgres(ctx, r))
	case "mysql", "mariadb":
		return finalize(start, probeMySQL(ctx, r))
	case "redis":
		return finalize(start, probeRedis(ctx, r))
	case "kafka":
		return finalize(start, probeKafka(ctx, r))
	case "minio":
		return finalize(start, probeMinio(ctx, r))
	case "http", "https":
		return finalize(start, probeHTTP(ctx, r, proto))
	default:
		return finalize(start, probeTCP(r))
	}
}

// finalize stamps latency (unless the prober already measured it) and defaults
// an empty status to offline.
func finalize(start time.Time, res ProbeResult) ProbeResult {
	if res.LatencyMs == 0 {
		res.LatencyMs = float64(time.Since(start).Microseconds()) / 1000.0
	}
	if res.Status == "" {
		res.Status = "offline"
	}
	if res.Metrics == nil {
		res.Metrics = map[string]interface{}{}
	}
	return res
}

func offline(err error) ProbeResult {
	return ProbeResult{Status: "offline", Error: err.Error(), Metrics: map[string]interface{}{}}
}

// ── Postgres ────────────────────────────────────────────────────────────────

func probePostgres(ctx context.Context, r models.Resource) ProbeResult {
	dbName := r.Database
	if dbName == "" {
		dbName = "postgres"
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable&connect_timeout=6",
		r.Username, r.Password, r.Host, r.Port, dbName)

	conn, err := sql.Open("pgx", dsn)
	if err != nil {
		return offline(err)
	}
	defer conn.Close()
	if err := conn.PingContext(ctx); err != nil {
		return offline(err)
	}

	m := map[string]interface{}{}
	var version string
	if conn.QueryRowContext(ctx, "SHOW server_version").Scan(&version) == nil {
		m["version"] = version
	}
	var active, total, idle, idleTx, maxConn int
	if conn.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity").Scan(&total) == nil {
		m["connections"] = total
	}
	if conn.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'").Scan(&active) == nil {
		m["active_queries"] = active
	}
	if conn.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle'").Scan(&idle) == nil {
		m["idle_connections"] = idle
	}
	if conn.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'").Scan(&idleTx) == nil {
		m["idle_in_txn"] = idleTx
	}
	if conn.QueryRowContext(ctx, "SELECT setting::int FROM pg_settings WHERE name = 'max_connections'").Scan(&maxConn) == nil {
		m["max_connections"] = maxConn
	}
	var sizeBytes int64
	if conn.QueryRowContext(ctx, "SELECT pg_database_size(current_database())").Scan(&sizeBytes) == nil {
		m["db_size_mb"] = round1(float64(sizeBytes) / (1024 * 1024))
	}
	// Cache hit ratio across the cluster — a key Postgres health signal.
	var blksHit, blksRead float64
	if conn.QueryRowContext(ctx, "SELECT COALESCE(sum(blks_hit),0), COALESCE(sum(blks_read),0) FROM pg_stat_database").Scan(&blksHit, &blksRead) == nil {
		if blksHit+blksRead > 0 {
			m["cache_hit_pct"] = round1(blksHit / (blksHit + blksRead) * 100)
		}
	}
	// Cumulative transaction counter for this DB — the frontend derives TPS from deltas.
	var commits, rollbacks int64
	if conn.QueryRowContext(ctx, "SELECT COALESCE(xact_commit,0), COALESCE(xact_rollback,0) FROM pg_stat_database WHERE datname = current_database()").Scan(&commits, &rollbacks) == nil {
		m["commits_total"] = commits
		m["rollbacks_total"] = rollbacks
	}
	// Longest currently-running query (seconds) — surfaces stuck/slow work.
	var longest float64
	if conn.QueryRowContext(ctx, "SELECT COALESCE(max(extract(epoch FROM now() - query_start)),0) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()").Scan(&longest) == nil {
		m["longest_query_sec"] = round1(longest)
	}
	var uptime float64
	if conn.QueryRowContext(ctx, "SELECT extract(epoch FROM now() - pg_postmaster_start_time())").Scan(&uptime) == nil {
		m["uptime_seconds"] = int64(uptime)
	}

	status := "online"
	if maxConn > 0 && float64(total)/float64(maxConn) > 0.9 {
		status = "degraded"
	}
	return ProbeResult{Status: status, Metrics: m}
}

// ── MySQL ───────────────────────────────────────────────────────────────────

func probeMySQL(ctx context.Context, r models.Resource) ProbeResult {
	dbName := r.Database
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?timeout=6s",
		r.Username, r.Password, r.Host, r.Port, dbName)

	conn, err := sql.Open("mysql", dsn)
	if err != nil {
		return offline(err)
	}
	defer conn.Close()
	if err := conn.PingContext(ctx); err != nil {
		return offline(err)
	}

	m := map[string]interface{}{}
	var version string
	if conn.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version) == nil {
		m["version"] = version
	}
	m["connections"] = mysqlStatusInt(ctx, conn, "Threads_connected")
	m["active_queries"] = mysqlStatusInt(ctx, conn, "Threads_running")
	if up := mysqlStatusInt(ctx, conn, "Uptime"); up > 0 {
		m["uptime_seconds"] = up
	}
	return ProbeResult{Status: "online", Metrics: m}
}

func mysqlStatusInt(ctx context.Context, conn *sql.DB, name string) int64 {
	var k string
	var v int64
	if conn.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE ?", name).Scan(&k, &v) == nil {
		return v
	}
	return 0
}

// ── Redis ───────────────────────────────────────────────────────────────────

func probeRedis(ctx context.Context, r models.Resource) ProbeResult {
	opt := &redis.Options{
		Addr:        net.JoinHostPort(r.Host, strconv.Itoa(r.Port)),
		Password:    firstNonEmpty(r.Password, r.Secret),
		DialTimeout: 6 * time.Second,
		Dialer: func(_ context.Context, _, _ string) (net.Conn, error) {
			return DialResource(r.Host, r.Port, r.UseGateway)
		},
	}
	client := redis.NewClient(opt)
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		return offline(err)
	}

	m := map[string]interface{}{}
	info, err := client.Info(ctx).Result()
	if err == nil {
		kv := parseRedisInfo(info)
		if v := kv["redis_version"]; v != "" {
			m["version"] = v
		}
		if v := toInt(kv["used_memory"]); v > 0 {
			m["memory_used_mb"] = round1(float64(v) / (1024 * 1024))
		}
		if v := toInt(kv["connected_clients"]); v >= 0 && kv["connected_clients"] != "" {
			m["connections"] = v
		}
		if v := toInt(kv["instantaneous_ops_per_sec"]); kv["instantaneous_ops_per_sec"] != "" {
			m["ops_per_sec"] = v
		}
		if v := toInt(kv["uptime_in_seconds"]); v > 0 {
			m["uptime_seconds"] = v
		}
		hits, misses := toInt(kv["keyspace_hits"]), toInt(kv["keyspace_misses"])
		if hits+misses > 0 {
			m["hit_rate_pct"] = round1(float64(hits) / float64(hits+misses) * 100)
		}
		if v := kv["total_commands_processed"]; v != "" {
			m["commands_total"] = toInt(v) // counter -> frontend derives commands/sec
		}
		if v := kv["evicted_keys"]; v != "" {
			m["evicted_keys"] = toInt(v)
		}
		if v := kv["blocked_clients"]; v != "" {
			m["blocked_clients"] = toInt(v)
		}
	}
	if n, err := client.DBSize(ctx).Result(); err == nil {
		m["keys"] = n
	}
	return ProbeResult{Status: "online", Metrics: m}
}

func parseRedisInfo(info string) map[string]string {
	kv := map[string]string{}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if i := strings.IndexByte(line, ':'); i > 0 {
			kv[line[:i]] = strings.TrimSpace(line[i+1:])
		}
	}
	return kv
}

// ── Kafka ───────────────────────────────────────────────────────────────────

func probeKafka(ctx context.Context, r models.Resource) ProbeResult {
	dialer := &kafka.Dialer{
		Timeout: 6 * time.Second,
		DialFunc: func(_ context.Context, _, _ string) (net.Conn, error) {
			return DialResource(r.Host, r.Port, r.UseGateway)
		},
	}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(r.Host, strconv.Itoa(r.Port)))
	if err != nil {
		return offline(err)
	}
	defer conn.Close()

	brokers, err := conn.Brokers()
	if err != nil {
		return offline(err)
	}
	partitions, err := conn.ReadPartitions()
	if err != nil {
		return offline(err)
	}
	topics := map[string]struct{}{}
	for _, p := range partitions {
		if strings.HasPrefix(p.Topic, "__") {
			continue // internal topics (__consumer_offsets, etc.)
		}
		topics[p.Topic] = struct{}{}
	}
	m := map[string]interface{}{
		"brokers":    len(brokers),
		"topics":     len(topics),
		"partitions": len(partitions),
	}
	return ProbeResult{Status: "online", Metrics: m}
}

// ── MinIO ───────────────────────────────────────────────────────────────────

func probeMinio(ctx context.Context, r models.Resource) ProbeResult {
	endpoint := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	creds := credentials.NewStaticV4(r.Username, firstNonEmpty(r.Password, r.Secret), "")
	transport := &http.Transport{
		DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
			return DialResource(r.Host, r.Port, r.UseGateway)
		},
	}
	client, err := madmin.NewWithOptions(endpoint, &madmin.Options{
		Creds:     creds,
		Secure:    false,
		Transport: transport,
	})
	if err != nil {
		return offline(err)
	}

	info, err := client.ServerInfo(ctx)
	if err != nil {
		return offline(err)
	}

	m := map[string]interface{}{
		"mode":    info.Mode,
		"buckets": info.Buckets.Count,
		"objects": info.Objects.Count,
	}

	if s3Client, err := minio.New(endpoint, &minio.Options{
		Creds:     creds,
		Secure:    false,
		Transport: transport,
	}); err == nil {
		if buckets, err := s3Client.ListBuckets(ctx); err == nil {
			names := make([]string, len(buckets))
			for i, b := range buckets {
				names[i] = b.Name
			}
			m["bucket_names"] = names
			m["buckets"] = len(names) // authoritative — admin usage-crawler count lags on a fresh server
		}
	}
	if info.Usage.Size > 0 {
		m["usage_mb"] = round1(float64(info.Usage.Size) / (1024 * 1024))
	}

	status := "online"
	var totalSpace, usedSpace uint64
	onlineDisks, totalDisks := 0, 0
	for i, srv := range info.Servers {
		if i == 0 {
			m["version"] = srv.Version
			m["uptime_seconds"] = srv.Uptime
		}
		if srv.State != "online" {
			status = "degraded"
		}
		for _, d := range srv.Disks {
			totalDisks++
			totalSpace += d.TotalSpace
			usedSpace += d.UsedSpace
			if d.State == madmin.DriveStateOk {
				onlineDisks++
			}
		}
	}
	if totalDisks > 0 {
		m["disks_online"] = onlineDisks
		m["disks_total"] = totalDisks
		if onlineDisks < totalDisks {
			status = "degraded"
		}
	}
	if totalSpace > 0 {
		m["capacity_gb"] = round1(float64(totalSpace) / (1024 * 1024 * 1024))
		m["used_pct"] = round1(float64(usedSpace) / float64(totalSpace) * 100)
	}

	return ProbeResult{Status: status, Metrics: m}
}

// ── HTTP / TCP fallbacks ─────────────────────────────────────────────────────

func probeHTTP(ctx context.Context, r models.Resource, scheme string) ProbeResult {
	dialContext := func(_ context.Context, _, _ string) (net.Conn, error) {
		return DialResource(r.Host, r.Port, r.UseGateway)
	}
	client := &http.Client{
		Timeout:   probeTimeout,
		Transport: &http.Transport{DialContext: dialContext},
	}
	url := fmt.Sprintf("%s://%s:%d/", scheme, r.Host, r.Port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return offline(err)
	}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return offline(err)
	}
	defer resp.Body.Close()

	latency := float64(time.Since(start).Microseconds()) / 1000.0
	m := map[string]interface{}{
		"http_status":      resp.StatusCode,
		"response_time_ms": round1(latency),
	}
	status := "online"
	if resp.StatusCode >= 500 {
		status = "offline"
	} else if resp.StatusCode >= 400 {
		status = "degraded"
	}
	return ProbeResult{Status: status, LatencyMs: latency, Metrics: m, Error: httpErr(resp.StatusCode)}
}

func probeTCP(r models.Resource) ProbeResult {
	start := time.Now()
	conn, err := DialResource(r.Host, r.Port, r.UseGateway)
	if err != nil {
		return offline(err)
	}
	defer conn.Close()
	latency := float64(time.Since(start).Microseconds()) / 1000.0
	// Peek the banner some services emit on connect (SSH, SMTP, Redis…).
	banner := readBanner(conn)
	m := map[string]interface{}{"response_time_ms": round1(latency)}
	if banner != "" {
		m["banner"] = banner
	}
	return ProbeResult{Status: "online", LatencyMs: latency, Metrics: m}
}

func readBanner(conn net.Conn) string {
	_ = conn.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil && line == "" {
		return ""
	}
	line = strings.TrimSpace(line)
	if len(line) > 80 {
		line = line[:80]
	}
	return line
}

// ── helpers ─────────────────────────────────────────────────────────────────

func httpErr(code int) string {
	if code >= 400 {
		return fmt.Sprintf("http status %d", code)
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func toInt(s string) int64 {
	v, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return v
}

func round1(f float64) float64 {
	return float64(int64(f*10+0.5)) / 10
}
