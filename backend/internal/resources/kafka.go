package resources

import (
	"context"
	"net"
	"strconv"
	"time"

	"github.com/segmentio/kafka-go"

	"github.com/infra-eye/backend/internal/models"
)

// KafkaDialer returns a gateway-aware dialer for a Kafka resource, the same
// dialer shape probeKafka already uses for connectivity checks.
func KafkaDialer(r models.Resource) *kafka.Dialer {
	return &kafka.Dialer{
		Timeout: 8 * time.Second,
		DialFunc: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialResourceCtx(ctx, r.Host, r.Port, r.UseGateway)
		},
	}
}

// KafkaClient returns a gateway-aware kafka.Client for broker-level requests
// (ListGroups, OffsetFetch) that the connection-oriented kafka.Conn API
// doesn't expose.
func KafkaClient(r models.Resource) *kafka.Client {
	return &kafka.Client{
		Addr:    kafka.TCP(net.JoinHostPort(r.Host, strconv.Itoa(r.Port))),
		Timeout: 8 * time.Second,
		Transport: &kafka.Transport{
			DialTimeout: 8 * time.Second,
			Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return dialResourceCtx(ctx, r.Host, r.Port, r.UseGateway)
			},
		},
	}
}
