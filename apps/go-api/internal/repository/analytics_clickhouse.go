package repository

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"go-api/infra/clickhouse"
)

// AnalyticsClickHouse manages ClickHouse data access for all analytical,
// candidate review, training cohort, target, and anomaly operations.
// The domain-specific methods are organized across:
// - analytics_clickhouse_candidates.go
// - analytics_clickhouse_training.go
// - analytics_clickhouse_targets.go
// - analytics_clickhouse_anomalies.go
type AnalyticsClickHouse struct {
	client                     *clickhouse.Client
	candidateReviewSchemaMu    sync.Mutex
	candidateReviewSchemaReady bool
}

func NewAnalyticsClickHouse(client *clickhouse.Client) *AnalyticsClickHouse {
	return &AnalyticsClickHouse{client: client}
}

func (r *AnalyticsClickHouse) Ping(ctx context.Context) error {
	return r.client.Ping(ctx)
}

// escapeSQL provides basic single-quote escaping for ClickHouse SQL string interpolation.
func escapeSQL(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func toInt64(v any) int64 {
	switch val := v.(type) {
	case float64:
		return int64(val)
	case string:
		n, _ := strconv.ParseInt(val, 10, 64)
		return n
	default:
		return 0
	}
}

func toBool(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case float64:
		return val != 0
	case string:
		return val == "true" || val == "1"
	default:
		return false
	}
}
