package resources

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/infra-eye/backend/internal/models"
)

// dialResourceCtx wraps DialResource (which has no context parameter of its
// own and enforces only its own fixed dial timeout) so callers that pass a
// shorter-lived context — probe.go's probeTimeout in particular — actually
// get to give up on schedule instead of blocking for DialResource's full
// internal timeout on an unreachable host. The dial itself isn't
// interruptible mid-flight (net.Dialer offers no such hook once started), so
// on ctx expiry this returns immediately and leaves the dial to fail or
// succeed on its own — a successful-but-late connection is closed right
// away rather than leaked.
func dialResourceCtx(ctx context.Context, host string, port int, useGateway bool) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		conn, err := DialResource(host, port, useGateway)
		ch <- result{conn, err}
	}()
	select {
	case <-ctx.Done():
		go func() {
			if r := <-ch; r.conn != nil {
				r.conn.Close()
			}
		}()
		return nil, ctx.Err()
	case r := <-ch:
		return r.conn, r.err
	}
}

// IsPostgres/IsMySQL classify a resource's protocol field for the SQL client
// code paths — accepting the common aliases operators actually type in.
func IsPostgres(protocol string) bool {
	p := strings.ToLower(strings.TrimSpace(protocol))
	return p == "postgres" || p == "postgresql"
}

func IsMySQL(protocol string) bool {
	p := strings.ToLower(strings.TrimSpace(protocol))
	return p == "mysql" || p == "mariadb"
}

// OpenSQL returns a *sql.DB for a Postgres or MySQL resource that dials
// through DialResource — the same gateway-or-direct choke point every other
// prober (probeRedis, probeKafka, probeMinIO) already respects. Every prior
// SQL code path here (probePostgres/probeMySQL's own health-check dial, and
// handlers.QueryResource's raw gorm.Open(dsn)) built a plain DSN and let the
// driver dial straight to resource.Host, silently ignoring UseGateway —
// this is the fix, applied once so every caller inherits it.
func OpenSQL(ctx context.Context, r models.Resource) (*sql.DB, error) {
	switch {
	case IsPostgres(r.Protocol):
		return openPostgres(r)
	case IsMySQL(r.Protocol):
		return openMySQL(r)
	default:
		return nil, fmt.Errorf("unsupported protocol %q for SQL access (postgres/mysql only)", r.Protocol)
	}
}

func openPostgres(r models.Resource) (*sql.DB, error) {
	dbName := r.Database
	if dbName == "" {
		dbName = "postgres"
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		r.Username, r.Password, r.Host, r.Port, dbName)

	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	// Swap the dialer only — everything else (TLS, auth, startup params)
	// stays exactly what ParseConfig derived from the DSN above. pgx invokes
	// this with its own per-operation context (e.g. the ctx passed to
	// PingContext/QueryContext), which is why that ctx — not OpenSQL's
	// caller-scoped one — is what dialResourceCtx is given here.
	config.DialFunc = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialResourceCtx(ctx, r.Host, r.Port, r.UseGateway)
	}
	return stdlib.OpenDB(*config), nil
}

// go-sql-driver/mysql's gateway hook is a process-global registry keyed by
// network name (RegisterDialContext, internally mutex-guarded), unlike pgx's
// per-config DialFunc. Each resource gets its own network name (its id) so
// concurrent queries against different resources never cross-talk;
// re-registering that same name on every call (rather than once, cached)
// is deliberate and cheap — it keeps the dialer's captured host/port/gateway
// flag current if the resource was edited since the last query, instead of
// silently dialing stale connection info forever.
func openMySQL(r models.Resource) (*sql.DB, error) {
	netName := fmt.Sprintf("infraeye-gateway-%d", r.ID)
	host, port, useGateway := r.Host, r.Port, r.UseGateway

	mysql.RegisterDialContext(netName, func(ctx context.Context, _ string) (net.Conn, error) {
		return dialResourceCtx(ctx, host, port, useGateway)
	})

	cfg := mysql.NewConfig()
	cfg.Net = netName
	cfg.Addr = net.JoinHostPort(r.Host, fmt.Sprint(r.Port))
	cfg.User = r.Username
	cfg.Passwd = r.Password
	cfg.DBName = r.Database

	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, fmt.Errorf("open mysql: %w", err)
	}
	return db, nil
}
