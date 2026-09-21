//go:build live

package benches

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// TestLiveMASTBatchTiming performs live timing measurements against the official MAST API
// to verify server response times and status codes across batch sizes.
// Run with: go test -v -tags=live -run=TestLiveMASTBatchTiming ./benches
func TestLiveMASTBatchTiming(t *testing.T) {
	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := "https://mast.stsci.edu/api/v0/invoke"

	// Sample real TIC IDs from TESS Sector 2
	baseTIC := int64(100100827)
	batchSizes := []int{100, 250, 500}

	for _, size := range batchSizes {
		ids := make([]int64, size)
		for i := 0; i < size; i++ {
			ids[i] = baseTIC + int64(i)
		}

		start := time.Now()
		records, err := queryBatch(context.Background(), client, endpoint, ids)
		elapsed := time.Since(start)

		if err != nil {
			t.Logf("[LIVE MAST] BatchSize=%d FAILED after %v: %v", size, elapsed, err)
		} else {
			t.Logf("[LIVE MAST] BatchSize=%d SUCCEEDED in %v (fetched %d records, %.2f records/sec)",
				size, elapsed, len(records), float64(len(records))/elapsed.Seconds())
		}
	}
}
