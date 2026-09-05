package resources

import (
	"context"
	"net"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/infra-eye/backend/internal/models"
)

// OpenRedis returns a gateway-aware Redis client for r — the same
// DialResource choke point every other resource operation uses, via
// dialResourceCtx so the caller's own context timeout is respected rather
// than blocking for DialResource's longer internal one. Shared by probeRedis
// (health-check) and the key-browser handlers so there's exactly one place
// that builds a Redis connection for a resource.
func OpenRedis(r models.Resource) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:        net.JoinHostPort(r.Host, strconv.Itoa(r.Port)),
		Password:    firstNonEmpty(r.Password, r.Secret),
		DialTimeout: 6 * time.Second,
		Dialer: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialResourceCtx(ctx, r.Host, r.Port, r.UseGateway)
		},
	})
}
