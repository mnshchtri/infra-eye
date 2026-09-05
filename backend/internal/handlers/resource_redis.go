package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
	"github.com/redis/go-redis/v9"
)

// loadRedisResource is loadSQLResource's counterpart for Redis endpoints.
func loadRedisResource(c *gin.Context) (models.Resource, bool) {
	var resource models.Resource
	if err := db.DB.First(&resource, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return resource, false
	}
	if resource.Protocol != "redis" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only redis resources support key browsing"})
		return resource, false
	}
	return resource, true
}

const defaultScanCount = 100

// GetResourceRedisKeys lists keys matching pattern (default "*") via SCAN —
// never KEYS, which blocks the whole server on a large keyspace. cursor is
// opaque to the client: pass back whatever this returned until it comes back
// "0", which means the scan is complete.
func GetResourceRedisKeys(c *gin.Context) {
	resource, ok := loadRedisResource(c)
	if !ok {
		return
	}
	pattern := c.DefaultQuery("pattern", "*")
	cursor, _ := strconv.ParseUint(c.DefaultQuery("cursor", "0"), 10, 64)
	count := int64(defaultScanCount)
	if v, err := strconv.ParseInt(c.Query("count"), 10, 64); err == nil && v > 0 && v <= 1000 {
		count = v
	}

	client := resources.OpenRedis(resource)
	defer client.Close()

	keys, nextCursor, err := client.Scan(c.Request.Context(), cursor, pattern, count).Result()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("scan failed: %v", err)})
		return
	}
	if keys == nil {
		keys = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"keys": keys, "cursor": strconv.FormatUint(nextCursor, 10)})
}

// redisKeyResponse is the normalized shape every Redis type gets read into —
// Value's actual shape depends on Type: string for "string", map[string]string
// for "hash", []string for "list"/"set", []ZMember for "zset".
type redisKeyResponse struct {
	Key        string      `json:"key"`
	Type       string      `json:"type"`
	TTLSeconds int64       `json:"ttl_seconds"` // -1 = no expiry, -2 = key doesn't exist
	Value      interface{} `json:"value"`
}

type zMember struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

// GetResourceRedisKey reads one key's type, value, and TTL. key arrives as a
// query parameter rather than a path segment specifically so it can contain
// any byte a real Redis key might (colons, slashes, binary-ish text) without
// route-parsing ambiguity.
func GetResourceRedisKey(c *gin.Context) {
	resource, ok := loadRedisResource(c)
	if !ok {
		return
	}
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	client := resources.OpenRedis(resource)
	defer client.Close()
	ctx := c.Request.Context()

	keyType, err := client.Type(ctx, key).Result()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("type failed: %v", err)})
		return
	}
	if keyType == "none" {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("key %q not found", key)})
		return
	}

	ttl, err := client.TTL(ctx, key).Result()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("ttl failed: %v", err)})
		return
	}
	ttlSeconds := int64(-1)
	if ttl > 0 {
		ttlSeconds = int64(ttl.Seconds())
	}

	var value interface{}
	switch keyType {
	case "string":
		value, err = client.Get(ctx, key).Result()
	case "hash":
		value, err = client.HGetAll(ctx, key).Result()
	case "list":
		value, err = client.LRange(ctx, key, 0, -1).Result()
	case "set":
		value, err = client.SMembers(ctx, key).Result()
	case "zset":
		var zs []redis.Z
		zs, err = client.ZRangeWithScores(ctx, key, 0, -1).Result()
		members := make([]zMember, 0, len(zs))
		for _, z := range zs {
			member, _ := z.Member.(string)
			members = append(members, zMember{Member: member, Score: z.Score})
		}
		value = members
	default:
		err = fmt.Errorf("unsupported redis type %q", keyType)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("read value failed: %v", err)})
		return
	}

	c.JSON(http.StatusOK, redisKeyResponse{Key: key, Type: keyType, TTLSeconds: ttlSeconds, Value: value})
}

type redisKeyWriteRequest struct {
	Key         string            `json:"key" binding:"required"`
	Type        string            `json:"type" binding:"required,oneof=string hash list set zset"`
	StringValue string            `json:"string_value"` // type=string
	Fields      map[string]string `json:"fields"`       // type=hash
	Items       []string          `json:"items"`        // type=list|set
	Members     []zMember         `json:"members"`      // type=zset
	TTLSeconds  *int64            `json:"ttl_seconds"`  // nil = leave as-is (or no expiry for a new key); 0 = persist (remove TTL)
}

// PutResourceRedisKey replaces a key's value wholesale: for hash/list/set/
// zset there's no partial "patch" concept here, so this deletes the key (if
// it exists) and rewrites it from the request's fields/items/members — the
// same "replace" semantics DataGrip-style tools use for a container value
// you've edited as a whole in the UI, rather than diffing individual entries.
func PutResourceRedisKey(c *gin.Context) {
	resource, ok := loadRedisResource(c)
	if !ok {
		return
	}
	if !requireWriteAccess(c, resource.ID) {
		return
	}
	var req redisKeyWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	client := resources.OpenRedis(resource)
	defer client.Close()
	ctx := c.Request.Context()

	if req.Type != "string" {
		// SET overwrites a string key outright; every other type needs the
		// old value cleared first since HSET/RPUSH/SADD/ZADD only add to
		// whatever's already there.
		if err := client.Del(ctx, req.Key).Err(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("clear existing value failed: %v", err)})
			return
		}
	}

	var err error
	switch req.Type {
	case "string":
		err = client.Set(ctx, req.Key, req.StringValue, 0).Err()
	case "hash":
		if len(req.Fields) > 0 {
			args := make([]interface{}, 0, len(req.Fields)*2)
			for k, v := range req.Fields {
				args = append(args, k, v)
			}
			err = client.HSet(ctx, req.Key, args...).Err()
		}
	case "list":
		if len(req.Items) > 0 {
			args := make([]interface{}, len(req.Items))
			for i, v := range req.Items {
				args[i] = v
			}
			err = client.RPush(ctx, req.Key, args...).Err()
		}
	case "set":
		if len(req.Items) > 0 {
			args := make([]interface{}, len(req.Items))
			for i, v := range req.Items {
				args[i] = v
			}
			err = client.SAdd(ctx, req.Key, args...).Err()
		}
	case "zset":
		if len(req.Members) > 0 {
			zs := make([]redis.Z, len(req.Members))
			for i, m := range req.Members {
				zs[i] = redis.Z{Score: m.Score, Member: m.Member}
			}
			err = client.ZAdd(ctx, req.Key, zs...).Err()
		}
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("write failed: %v", err)})
		return
	}

	if req.TTLSeconds != nil {
		if *req.TTLSeconds <= 0 {
			client.Persist(ctx, req.Key)
		} else {
			client.Expire(ctx, req.Key, time.Duration(*req.TTLSeconds)*time.Second)
		}
	}

	logResourceAudit(c, resource.ID, currentUserID(c), "edit_redis_key", gin.H{"key": req.Key, "type": req.Type})
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteResourceRedisKey deletes one key.
func DeleteResourceRedisKey(c *gin.Context) {
	resource, ok := loadRedisResource(c)
	if !ok {
		return
	}
	if !requireWriteAccess(c, resource.ID) {
		return
	}
	key := c.Query("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}

	client := resources.OpenRedis(resource)
	defer client.Close()

	deleted, err := client.Del(c.Request.Context(), key).Result()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("delete failed: %v", err)})
		return
	}

	logResourceAudit(c, resource.ID, currentUserID(c), "delete_redis_key", gin.H{"key": key})
	c.JSON(http.StatusOK, gin.H{"deleted": deleted})
}
