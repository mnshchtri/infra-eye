package handlers

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/segmentio/kafka-go"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
)

// loadKafkaResource is loadRedisResource's counterpart for Kafka endpoints.
// Kafka browsing is read-only, so unlike SQL/Redis there is no write gate.
func loadKafkaResource(c *gin.Context) (models.Resource, bool) {
	var resource models.Resource
	if err := db.DB.First(&resource, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return resource, false
	}
	if resource.Protocol != "kafka" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only kafka resources support topic browsing"})
		return resource, false
	}
	return resource, true
}

type kafkaTopicInfo struct {
	Name       string `json:"name"`
	Partitions int    `json:"partitions"`
}

// GetResourceKafkaTopics lists topics (excluding internal __-prefixed ones,
// same convention as the observability probe) with their partition counts.
func GetResourceKafkaTopics(c *gin.Context) {
	resource, ok := loadKafkaResource(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	dialer := resources.KafkaDialer(resource)
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(resource.Host, strconv.Itoa(resource.Port)))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("dial failed: %v", err)})
		return
	}
	defer conn.Close()

	partitions, err := conn.ReadPartitions()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read partitions failed: %v", err)})
		return
	}

	counts := map[string]int{}
	for _, p := range partitions {
		if strings.HasPrefix(p.Topic, "__") {
			continue
		}
		counts[p.Topic]++
	}
	topics := make([]kafkaTopicInfo, 0, len(counts))
	for name, n := range counts {
		topics = append(topics, kafkaTopicInfo{Name: name, Partitions: n})
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i].Name < topics[j].Name })

	c.JSON(http.StatusOK, gin.H{"topics": topics})
}

type kafkaPartitionOffset struct {
	Partition int   `json:"partition"`
	Low       int64 `json:"low"`  // oldest available offset
	High      int64 `json:"high"` // next offset to be written (high watermark)
}

// GetResourceKafkaTopicOffsets reports each partition's low/high watermark
// for one topic, dialing each partition's leader directly (the bootstrap
// connection alone can't answer offset queries).
func GetResourceKafkaTopicOffsets(c *gin.Context) {
	resource, ok := loadKafkaResource(c)
	if !ok {
		return
	}
	topic := c.Param("topic")
	ctx := c.Request.Context()
	dialer := resources.KafkaDialer(resource)
	addr := net.JoinHostPort(resource.Host, strconv.Itoa(resource.Port))

	bootstrap, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("dial failed: %v", err)})
		return
	}
	partitions, err := bootstrap.ReadPartitions(topic)
	bootstrap.Close()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read partitions failed: %v", err)})
		return
	}
	if len(partitions) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("topic %q not found", topic)})
		return
	}

	result := make([]kafkaPartitionOffset, 0, len(partitions))
	for _, p := range partitions {
		leader, err := dialer.DialLeader(ctx, "tcp", addr, topic, p.ID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("dial leader for partition %d failed: %v", p.ID, err)})
			return
		}
		low, lowErr := leader.ReadFirstOffset()
		high, highErr := leader.ReadLastOffset()
		leader.Close()
		if lowErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read low offset for partition %d failed: %v", p.ID, lowErr)})
			return
		}
		if highErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read high offset for partition %d failed: %v", p.ID, highErr)})
			return
		}
		result = append(result, kafkaPartitionOffset{Partition: p.ID, Low: low, High: high})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Partition < result[j].Partition })

	c.JSON(http.StatusOK, gin.H{"topic": topic, "partitions": result})
}

type kafkaMessage struct {
	Partition int       `json:"partition"`
	Offset    int64     `json:"offset"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	Timestamp time.Time `json:"timestamp"`
}

const (
	defaultMessageLimit = 20
	maxMessageLimit     = 200
)

// GetResourceKafkaMessages tails the most recent messages on one partition:
// it reads the low/high watermark first, seeks a reader to high-limit (never
// below low), and reads forward to the high watermark — a bounded read, not
// a live/streaming subscription.
func GetResourceKafkaMessages(c *gin.Context) {
	resource, ok := loadKafkaResource(c)
	if !ok {
		return
	}
	topic := c.Param("topic")
	partition, err := strconv.Atoi(c.DefaultQuery("partition", "0"))
	if err != nil || partition < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "partition must be a non-negative integer"})
		return
	}
	limit := defaultMessageLimit
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= maxMessageLimit {
		limit = v
	}

	ctx := c.Request.Context()
	dialer := resources.KafkaDialer(resource)
	addr := net.JoinHostPort(resource.Host, strconv.Itoa(resource.Port))

	leader, err := dialer.DialLeader(ctx, "tcp", addr, topic, partition)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("dial leader failed: %v", err)})
		return
	}
	low, lowErr := leader.ReadFirstOffset()
	high, highErr := leader.ReadLastOffset()
	leader.Close()
	if lowErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read low offset failed: %v", lowErr)})
		return
	}
	if highErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read high offset failed: %v", highErr)})
		return
	}
	if high <= low {
		c.JSON(http.StatusOK, gin.H{"messages": []kafkaMessage{}})
		return
	}

	start := high - int64(limit)
	if start < low {
		start = low
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:   []string{addr},
		Topic:     topic,
		Partition: partition,
		Dialer:    dialer,
		MinBytes:  1,
		MaxBytes:  10e6,
	})
	defer reader.Close()
	if err := reader.SetOffset(start); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("seek failed: %v", err)})
		return
	}

	readCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	want := high - start
	messages := make([]kafkaMessage, 0, want)
	for int64(len(messages)) < want {
		m, err := reader.ReadMessage(readCtx)
		if err != nil {
			break // deadline hit or reader closed — return whatever was read so far
		}
		messages = append(messages, kafkaMessage{
			Partition: m.Partition,
			Offset:    m.Offset,
			Key:       string(m.Key),
			Value:     string(m.Value),
			Timestamp: m.Time,
		})
	}

	logResourceAudit(c, resource.ID, currentUserID(c), "browse_kafka_messages", gin.H{"topic": topic, "partition": partition, "count": len(messages)})
	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

type kafkaGroupPartition struct {
	Topic           string `json:"topic"`
	Partition       int    `json:"partition"`
	CommittedOffset int64  `json:"committed_offset"`
	HighWatermark   int64  `json:"high_watermark"`
	Lag             int64  `json:"lag"`
}

type kafkaGroupInfo struct {
	GroupID      string                `json:"group_id"`
	ProtocolType string                `json:"protocol_type"`
	TotalLag     int64                 `json:"total_lag"`
	Partitions   []kafkaGroupPartition `json:"partitions"`
}

// GetResourceKafkaGroups lists consumer groups and, for each, its committed
// offset / high-watermark / lag per topic-partition it has offsets for.
func GetResourceKafkaGroups(c *gin.Context) {
	resource, ok := loadKafkaResource(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	client := resources.KafkaClient(resource)
	addr := kafka.TCP(net.JoinHostPort(resource.Host, strconv.Itoa(resource.Port)))

	listResp, err := client.ListGroups(ctx, &kafka.ListGroupsRequest{Addr: addr})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("list groups failed: %v", err)})
		return
	}
	if listResp.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": listResp.Error.Error()})
		return
	}

	dialer := resources.KafkaDialer(resource)
	hostPort := net.JoinHostPort(resource.Host, strconv.Itoa(resource.Port))
	highCache := map[string]map[int]int64{}
	highWatermark := func(topic string, partition int) (int64, error) {
		if byPart, ok := highCache[topic]; ok {
			if v, ok := byPart[partition]; ok {
				return v, nil
			}
		} else {
			highCache[topic] = map[int]int64{}
		}
		leader, err := dialer.DialLeader(ctx, "tcp", hostPort, topic, partition)
		if err != nil {
			return 0, err
		}
		defer leader.Close()
		h, err := leader.ReadLastOffset()
		if err != nil {
			return 0, err
		}
		highCache[topic][partition] = h
		return h, nil
	}

	groups := make([]kafkaGroupInfo, 0, len(listResp.Groups))
	for _, g := range listResp.Groups {
		info := kafkaGroupInfo{GroupID: g.GroupID, ProtocolType: g.ProtocolType, Partitions: []kafkaGroupPartition{}}

		offResp, err := client.OffsetFetch(ctx, &kafka.OffsetFetchRequest{Addr: addr, GroupID: g.GroupID})
		if err == nil && offResp.Error == nil {
			for topic, parts := range offResp.Topics {
				for _, p := range parts {
					high, hErr := highWatermark(topic, p.Partition)
					var lag int64
					if hErr == nil {
						lag = high - p.CommittedOffset
						if lag < 0 {
							lag = 0
						}
					}
					info.Partitions = append(info.Partitions, kafkaGroupPartition{
						Topic:           topic,
						Partition:       p.Partition,
						CommittedOffset: p.CommittedOffset,
						HighWatermark:   high,
						Lag:             lag,
					})
					info.TotalLag += lag
				}
			}
			sort.Slice(info.Partitions, func(i, j int) bool {
				if info.Partitions[i].Topic != info.Partitions[j].Topic {
					return info.Partitions[i].Topic < info.Partitions[j].Topic
				}
				return info.Partitions[i].Partition < info.Partitions[j].Partition
			})
		}
		groups = append(groups, info)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].GroupID < groups[j].GroupID })

	c.JSON(http.StatusOK, gin.H{"groups": groups})
}
