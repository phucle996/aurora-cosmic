package benches

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// createMockMASTServer creates a local test HTTP server simulating MAST TIC API
// with a configurable simulated network latency per request.
func createMockMASTServer(latency time.Duration) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if latency > 0 {
			time.Sleep(latency)
		}

		_ = r.ParseForm()
		reqBody := r.FormValue("request")
		var payload struct {
			Service string `json:"service"`
			Params  struct {
				Filters []struct {
					ParamName string  `json:"paramName"`
					Values    []int64 `json:"values"`
				} `json:"filters"`
			} `json:"params"`
		}
		_ = json.Unmarshal([]byte(reqBody), &payload)

		var requestedIDs []int64
		for _, f := range payload.Params.Filters {
			if f.ParamName == "ID" {
				requestedIDs = f.Values
				break
			}
		}

		type rawRow struct {
			ID   int64   `json:"ID"`
			RA   float64 `json:"ra"`
			Dec  float64 `json:"dec"`
			TMag float64 `json:"Tmag"`
			Teff float64 `json:"Teff"`
			Rad  float64 `json:"rad"`
			Mass float64 `json:"mass"`
			Logg float64 `json:"logg"`
		}

		rows := make([]rawRow, 0, len(requestedIDs))
		for _, id := range requestedIDs {
			rows = append(rows, rawRow{
				ID:   id,
				RA:   180.0,
				Dec:  45.0,
				TMag: 10.5,
				Teff: 5778.0,
				Rad:  1.0,
				Mass: 1.0,
				Logg: 4.44,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "COMPLETE",
			"data":   rows,
		})
	}))
}

// queryBatch fetches a single batch of TIC IDs from the mock server
func queryBatch(ctx context.Context, client *http.Client, endpoint string, ids []int64) ([]TICBenchRecord, error) {
	payload := map[string]any{
		"service": "Mast.Catalogs.Filtered.Tic.Rows",
		"format":  "json",
		"params": map[string]any{
			"columns": "ID,ra,dec,Tmag,Teff,rad,mass,logg",
			"filters": []map[string]any{
				{"paramName": "ID", "values": ids},
			},
		},
	}
	bodyData, _ := json.Marshal(payload)
	encoded := url.Values{"request": {string(bodyData)}}.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Status string `json:"status"`
		Data   []struct {
			ID   int64   `json:"ID"`
			RA   float64 `json:"ra"`
			Dec  float64 `json:"dec"`
			TMag float64 `json:"Tmag"`
			Teff float64 `json:"Teff"`
			Rad  float64 `json:"rad"`
			Mass float64 `json:"mass"`
			Logg float64 `json:"logg"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	records := make([]TICBenchRecord, 0, len(result.Data))
	for _, raw := range result.Data {
		r := raw
		records = append(records, TICBenchRecord{
			TICID:         r.ID,
			RADeg:         &r.RA,
			DecDeg:        &r.Dec,
			TMag:          &r.TMag,
			Teff:          &r.Teff,
			StellarRadius: &r.Rad,
			StellarMass:   &r.Mass,
			Logg:          &r.Logg,
		})
	}
	return records, nil
}

// executeSequential runs sequential batching (current codebase behavior)
func executeSequential(ctx context.Context, client *http.Client, endpoint string, ids []int64, batchSize int) ([]TICBenchRecord, error) {
	var allRecords []TICBenchRecord
	for start := 0; start < len(ids); start += batchSize {
		end := start + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		records, err := queryBatch(ctx, client, endpoint, ids[start:end])
		if err != nil {
			return nil, err
		}
		allRecords = append(allRecords, records...)
	}
	return allRecords, nil
}

// executeConcurrent runs worker-pool based concurrent batching
func executeConcurrent(ctx context.Context, client *http.Client, endpoint string, ids []int64, batchSize int, workers int) ([]TICBenchRecord, error) {
	type batchJob struct {
		batch []int64
	}

	chunks := (len(ids) + batchSize - 1) / batchSize
	jobs := make(chan batchJob, chunks)
	for start := 0; start < len(ids); start += batchSize {
		end := start + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		jobs <- batchJob{batch: ids[start:end]}
	}
	close(jobs)

	var mu sync.Mutex
	var allRecords []TICBenchRecord
	var errOnce sync.Once
	var workerErr error

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if workerErr != nil {
					return
				}
				records, err := queryBatch(ctx, client, endpoint, job.batch)
				if err != nil {
					errOnce.Do(func() { workerErr = err })
					return
				}
				mu.Lock()
				allRecords = append(allRecords, records...)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if workerErr != nil {
		return nil, workerErr
	}
	return allRecords, nil
}

// BenchmarkSyncTICBatching evaluates the throughput and latency difference
// between sequential execution (baseline) and concurrent execution across batch sizes.
// A 10ms simulated latency per request is used to model HTTP round-trip without excessively slowing down the test run.
func BenchmarkSyncTICBatching(b *testing.B) {
	server := createMockMASTServer(10 * time.Millisecond)
	defer server.Close()

	client := &http.Client{
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
		},
		Timeout: 10 * time.Second,
	}

	targetCounts := []int{500, 2000}

	for _, count := range targetCounts {
		ticIDs := make([]int64, count)
		for i := 0; i < count; i++ {
			ticIDs[i] = int64(100000000 + i)
		}

		// 1. Current baseline: Sequential with BatchSize = 100
		b.Run(fmt.Sprintf("targets_%d/Sequential_Batch100", count), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := executeSequential(context.Background(), client, server.URL, ticIDs, 100)
				if err != nil {
					b.Fatalf("sequential failed: %v", err)
				}
			}
		})

		// 2. Sequential with BatchSize = 250
		b.Run(fmt.Sprintf("targets_%d/Sequential_Batch250", count), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := executeSequential(context.Background(), client, server.URL, ticIDs, 250)
				if err != nil {
					b.Fatalf("sequential batch 250 failed: %v", err)
				}
			}
		})

		// 3. Concurrent with 4 Workers, BatchSize = 250
		b.Run(fmt.Sprintf("targets_%d/Concurrent_W4_Batch250", count), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := executeConcurrent(context.Background(), client, server.URL, ticIDs, 250, 4)
				if err != nil {
					b.Fatalf("concurrent w4 failed: %v", err)
				}
			}
		})

		// 4. Concurrent with 8 Workers, BatchSize = 250
		b.Run(fmt.Sprintf("targets_%d/Concurrent_W8_Batch250", count), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := executeConcurrent(context.Background(), client, server.URL, ticIDs, 250, 8)
				if err != nil {
					b.Fatalf("concurrent w8 failed: %v", err)
				}
			}
		})

		// 5. Concurrent with 8 Workers, BatchSize = 500
		b.Run(fmt.Sprintf("targets_%d/Concurrent_W8_Batch500", count), func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := executeConcurrent(context.Background(), client, server.URL, ticIDs, 500, 8)
				if err != nil {
					b.Fatalf("concurrent w8 batch 500 failed: %v", err)
				}
			}
		})
	}
}
