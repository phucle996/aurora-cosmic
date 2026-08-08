package main

import (
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/ingest"
)

// printPlanSummary prints a human-readable ingestion plan summary to stdout.
func printPlanSummary(m *model.Manifest, path string) {
	s := m.Statistics
	fmt.Println()
	fmt.Println("AURORA ingestion plan")
	fmt.Println()
	fmt.Printf("  paired samples:    %d\n", s.PairedCount)
	fmt.Printf("  TPF only:          %d\n", s.TPFOnlyCount)
	fmt.Printf("  LC only:           %d\n", s.LCOnlyCount)
	fmt.Printf("  FFI:               %d\n", s.FFICount)
	fmt.Println()
	fmt.Printf("  TPF data:          %s\n", humanBytes(s.TPFBytes))
	fmt.Printf("  LC data:           %s\n", humanBytes(s.LCBytes))
	fmt.Printf("  FFI data:          %s\n", humanBytes(s.FFIBytes))
	fmt.Println()
	fmt.Printf("  selected total:    %s\n", humanBytes(s.TotalBytes))
	fmt.Println()
	fmt.Printf("  manifest:          %s\n", path)
	fmt.Println()
}

// printResumeSummary prints recovery details when resuming an existing ingestion run.
func printResumeSummary(cp *model.Checkpoint) {
	published := 0
	stored := 0
	failed := 0
	remaining := 0

	for _, pc := range cp.Products {
		switch pc.State {
		case model.StatePublished:
			published++
		case model.StateStored:
			stored++
		case model.StateFailed:
			failed++
		default:
			remaining++
		}
	}

	fmt.Println()
	fmt.Println("AURORA ingestion resume")
	fmt.Println()
	fmt.Printf("  run_id:            %s\n", cp.RunID)
	fmt.Printf("  manifest products: %d\n", len(cp.Products))
	fmt.Printf("  already published: %d\n", published)
	fmt.Printf("  stored (pending):  %d\n", stored)
	fmt.Printf("  failed:            %d\n", failed)
	fmt.Printf("  remaining:         %d\n", remaining)
	fmt.Println()
}

// printIngestSummary prints overall operational metrics after ingestion run completes.
func printIngestSummary(s *model.Summary) {
	fmt.Println()
	fmt.Println("AURORA ingestion summary")
	fmt.Println()
	fmt.Printf("  products planned:  %d\n", s.PlannedProducts)
	fmt.Printf("  stored:            %d\n", s.StoredCount)
	fmt.Printf("  events published:  %d\n", s.PublishedCount)
	fmt.Printf("  skipped:           %d\n", s.SkippedCount)
	fmt.Printf("  failed:            %d\n", s.FailedCount)
	if s.StoredEventFailedCount > 0 {
		fmt.Printf("  event failed:      %d\n", s.StoredEventFailedCount)
	}
	fmt.Println()
	fmt.Printf("  bytes stored:      %s\n", humanBytes(s.StoredBytes))
	fmt.Printf("  elapsed:           %s\n", s.Elapsed.Round(time.Millisecond))
	if s.ThroughputBps > 0 {
		fmt.Printf("  throughput:        %s/s\n", humanBytes(int64(s.ThroughputBps)))
	}
	fmt.Println()
}

// progressPrinter renders Docker-pull-style single-line download progress.
// Updates are serialized because workers report concurrently.
type progressPrinter struct {
	out io.Writer
	mu  sync.Mutex
}

func newProgressPrinter(out io.Writer) *progressPrinter {
	return &progressPrinter{out: out}
}

func (p *progressPrinter) Update(event ingest.ProgressEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()

	percent := 0.0
	if event.TotalProducts > 0 {
		percent = float64(event.CompletedProducts) * 100 / float64(event.TotalProducts)
	}
	path := event.Result.ObjectKey
	if path == "" {
		path = event.Result.SourceProductID
	}
	path = compactPath(path, 72)

	totalBytes := "?"
	if event.TotalBytes > 0 {
		totalBytes = humanBytes(event.TotalBytes)
	}
	line := fmt.Sprintf("\rdownload %d/%d (%5.1f%%) | %s/%s | %s/s | workers %d/%d | %s",
		event.CompletedProducts,
		event.TotalProducts,
		percent,
		humanBytes(event.CompletedBytes),
		totalBytes,
		humanBytes(int64(event.ThroughputBps)),
		event.ActiveWorkers,
		event.ConfiguredWorkers,
		path,
	)
	// Pad the line so a shorter later path cannot leave stale characters in a
	// terminal. Docker log collectors preserve the carriage return naturally.
	fmt.Fprintf(p.out, "%-160s", line)
}

func (p *progressPrinter) Finish() {
	p.mu.Lock()
	defer p.mu.Unlock()
	fmt.Fprintln(p.out)
}

func compactPath(path string, maxLen int) string {
	if len(path) <= maxLen {
		return path
	}
	return "..." + strings.TrimPrefix(path[len(path)-maxLen+3:], "/")
}

// humanBytes formats byte counts into human-readable strings (KiB, MiB, GiB).
func humanBytes(b int64) string {
	const (
		KiB = 1024
		MiB = 1024 * KiB
		GiB = 1024 * MiB
	)
	switch {
	case b >= GiB:
		return fmt.Sprintf("%.2f GiB", float64(b)/GiB)
	case b >= MiB:
		return fmt.Sprintf("%.1f MiB", float64(b)/MiB)
	case b >= KiB:
		return fmt.Sprintf("%.1f KiB", float64(b)/KiB)
	default:
		return fmt.Sprintf("%d B", b)
	}
}
