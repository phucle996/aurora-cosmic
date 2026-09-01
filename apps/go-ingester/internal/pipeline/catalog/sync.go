package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"go-ingester/infra/storage"
)

const toiEndpoint = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
const toiQuery = "select tid as tic_id, toi as toi_id, pl_orbper as period, pl_tranmid as epoch, pl_trandurh as duration, pl_trandep as depth, tfopwg_disp from toi"

type Progress struct {
	State         string `json:"state"`
	Stage         string `json:"stage"`
	TICRows       int    `json:"tic_rows"`
	TOIRows       int    `json:"toi_rows"`
	Completed     int    `json:"completed"`
	Total         int    `json:"total"`
	TICSnapshotID string `json:"tic_snapshot_id,omitempty"`
	TOISnapshotID string `json:"toi_snapshot_id,omitempty"`
	Error         string `json:"error,omitempty"`
}
type TOIRecord struct {
	TOIID           string   `json:"toi_id"`
	TICID           int64    `json:"tic_id"`
	CatalogPeriod   *float64 `json:"catalog_period"`
	CatalogEpoch    *float64 `json:"catalog_epoch"`
	CatalogDuration *float64 `json:"catalog_duration"`
	CatalogDepth    *float64 `json:"catalog_depth"`
	DispositionRaw  string   `json:"toi_disposition_raw"`
	DispositionNorm string   `json:"toi_disposition_norm"`
}
type TICRecord struct {
	TICID         int64    `json:"tic_id"`
	RADeg         *float64 `json:"ra_deg"`
	DecDeg        *float64 `json:"dec_deg"`
	TMag          *float64 `json:"tmag"`
	Teff          *float64 `json:"teff"`
	StellarRadius *float64 `json:"stellar_radius"`
	StellarMass   *float64 `json:"stellar_mass"`
	Logg          *float64 `json:"logg"`
}
type rawTOI struct {
	TICID       *int64   `json:"tic_id"`
	TOIID       any      `json:"toi_id"`
	Period      *float64 `json:"period"`
	Epoch       *float64 `json:"epoch"`
	Duration    *float64 `json:"duration"`
	Depth       *float64 `json:"depth"`
	Disposition any      `json:"tfopwg_disp"`
}

func canonical(value any) []byte { data, _ := json.Marshal(value); return data }
func digest(data []byte) string  { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func disposition(raw string) string {
	upper := strings.ToUpper(strings.TrimSpace(raw))
	switch {
	case strings.Contains(upper, "KNOWN PLANET"), strings.Contains(upper, "CONFIRMED"), upper == "KP", upper == "CP":
		return "KNOWN_PLANET"
	case strings.Contains(upper, "FALSE POSITIVE"), upper == "FP", upper == "FA":
		return "FALSE_POSITIVE"
	case strings.Contains(upper, "CANDIDATE"), upper == "PC", strings.Contains(upper, "TOI"):
		return "CANDIDATE"
	case upper == "":
		return "UNKNOWN"
	default:
		return "OTHER"
	}
}

func writeProgress(ctx context.Context, store *storage.MinIOClient, bucket string, p Progress) {
	_ = store.PutJSON(ctx, bucket, "control/ingest/catalog-status.json", canonical(p))
}

func ReportFailure(ctx context.Context, store *storage.MinIOClient, bucket, stage string, err error) {
	writeProgress(ctx, store, bucket, Progress{State: "FAILED", Stage: stage, Total: 2, Error: err.Error()})
}

func ReportCanceled(ctx context.Context, store *storage.MinIOClient, bucket, stage string) {
	writeProgress(ctx, store, bucket, Progress{State: "CANCELED", Stage: stage, Total: 2})
}

func SyncTOI(ctx context.Context, store *storage.MinIOClient, bucket string) (map[int64]struct{}, string, int, error) {
	progress := Progress{State: "RUNNING", Stage: "DOWNLOADING_TOI", Completed: 0, Total: 2}
	writeProgress(ctx, store, bucket, progress)
	requestURL := toiEndpoint + "?" + url.Values{"query": {toiQuery}, "format": {"json"}}.Encode()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		progress.State = "FAILED"
		progress.Error = err.Error()
		writeProgress(ctx, store, bucket, progress)
		return nil, "", 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, "", 0, fmt.Errorf("TOI provider HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, "", 0, err
	}
	var raw []rawTOI
	if err = json.Unmarshal(body, &raw); err != nil {
		return nil, "", 0, fmt.Errorf("decode TOI catalog: %w", err)
	}
	records := make([]TOIRecord, 0, len(raw))
	targets := make(map[int64]struct{})
	for _, row := range raw {
		if row.TICID == nil || *row.TICID <= 0 {
			continue
		}
		id := fmt.Sprint(row.TOIID)
		d := fmt.Sprint(row.Disposition)
		records = append(records, TOIRecord{id, *row.TICID, row.Period, row.Epoch, row.Duration, row.Depth, d, disposition(d)})
		targets[*row.TICID] = struct{}{}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].TICID == records[j].TICID {
			return records[i].TOIID < records[j].TOIID
		}
		return records[i].TICID < records[j].TICID
	})
	data := canonical(records)
	dataSHA := digest(data)
	identity := digest([]byte("TOI:toi-normalize-v1:" + dataSHA))
	snapshotID := "toi-v1-" + identity[:12]
	root := "catalogs/snapshots/toi/" + snapshotID
	manifest := map[string]any{"schema_version": "catalog-snapshot-v1", "catalog_type": "TOI", "snapshot_id": snapshotID, "snapshot_fingerprint": dataSHA, "normalization_version": "toi-normalize-v1", "provider": "NASA Exoplanet Archive", "source_uri": toiEndpoint, "source_query": toiQuery, "retrieved_at": time.Now().UTC().Format(time.RFC3339Nano), "row_count": len(records), "data_object_key": root + "/records.json", "data_sha256": dataSHA}
	if err = store.PutJSON(ctx, bucket, root+"/records.json", data); err != nil {
		return nil, "", 0, err
	}
	manifestData := canonical(manifest)
	if err = store.PutJSON(ctx, bucket, root+"/manifest.json", manifestData); err != nil {
		return nil, "", 0, err
	}
	pointer := map[string]any{"schema_version": "catalog-pointer-v1", "catalog_type": "TOI", "snapshot_id": snapshotID, "manifest_key": root + "/manifest.json", "manifest_sha256": digest(manifestData)}
	if err = store.PutJSON(ctx, bucket, "catalogs/current/toi.json", canonical(pointer)); err != nil {
		return nil, "", 0, err
	}
	progress.State = "RUNNING"
	progress.Stage = "TOI_READY_WAITING_FOR_MANIFEST_TARGETS"
	progress.TOIRows = len(records)
	progress.TOISnapshotID = snapshotID
	progress.Completed = 1
	writeProgress(ctx, store, bucket, progress)
	return targets, snapshotID, len(records), nil
}

func SyncTIC(ctx context.Context, store *storage.MinIOClient, bucket string, ticIDs []int64, toiSnapshotID string, toiRows int) (string, error) {
	progress := Progress{State: "RUNNING", Stage: "DOWNLOADING_TIC", TOIRows: toiRows, TOISnapshotID: toiSnapshotID, Completed: 1, Total: 2}
	requested := make([]int64, 0, len(ticIDs))
	seen := map[int64]struct{}{}
	for _, id := range ticIDs {
		if id > 0 {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				requested = append(requested, id)
			}
		}
	}
	sort.Slice(requested, func(i, j int) bool { return requested[i] < requested[j] })
	rows := make([]TICRecord, 0, len(requested))
	client := &http.Client{Timeout: 90 * time.Second}
	for start := 0; start < len(requested); start += 100 {
		end := start + 100
		if end > len(requested) {
			end = len(requested)
		}
		payload := map[string]any{"service": "Mast.Catalogs.Filtered.Tic.Rows", "format": "json", "params": map[string]any{"columns": "ID,ra,dec,Tmag,Teff,rad,mass,logg", "filters": []map[string]any{{"paramName": "ID", "values": requested[start:end]}}}}
		encoded := url.Values{"request": {string(canonical(payload))}}.Encode()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://mast.stsci.edu/api/v0/invoke", strings.NewReader(encoded))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var result struct {
			Status string           `json:"status"`
			Data   []map[string]any `json:"data"`
		}
		if err = json.Unmarshal(body, &result); err != nil || result.Status != "COMPLETE" {
			return "", fmt.Errorf("invalid MAST TIC response")
		}
		for _, raw := range result.Data {
			id, ok := numberInt64(raw["ID"])
			if !ok {
				continue
			}
			rows = append(rows, TICRecord{id, numberFloat(raw["ra"]), numberFloat(raw["dec"]), numberFloat(raw["Tmag"]), numberFloat(raw["Teff"]), numberFloat(raw["rad"]), numberFloat(raw["mass"]), numberFloat(raw["logg"])})
		}
		progress.TICRows = len(rows)
		writeProgress(ctx, store, bucket, progress)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].TICID < rows[j].TICID })
	data := canonical(rows)
	dataSHA := digest(data)
	identity := digest([]byte("TIC:tic-normalize-v1:" + dataSHA))
	snapshotID := "tic-v1-" + identity[:12]
	root := "catalogs/snapshots/tic/" + snapshotID
	manifest := map[string]any{"schema_version": "catalog-snapshot-v1", "catalog_type": "TIC", "snapshot_id": snapshotID, "snapshot_fingerprint": dataSHA, "normalization_version": "tic-normalize-v1", "provider": "MAST/STScI", "source_uri": "https://mast.stsci.edu/api/v0/invoke", "source_query": "TIC IDs pinned by ingest manifest", "retrieved_at": time.Now().UTC().Format(time.RFC3339Nano), "row_count": len(rows), "data_object_key": root + "/records.json", "data_sha256": dataSHA}
	if err := store.PutJSON(ctx, bucket, root+"/records.json", data); err != nil {
		return "", err
	}
	manifestData := canonical(manifest)
	if err := store.PutJSON(ctx, bucket, root+"/manifest.json", manifestData); err != nil {
		return "", err
	}
	pointer := map[string]any{"schema_version": "catalog-pointer-v1", "catalog_type": "TIC", "snapshot_id": snapshotID, "manifest_key": root + "/manifest.json", "manifest_sha256": digest(manifestData)}
	if err := store.PutJSON(ctx, bucket, "catalogs/current/tic.json", canonical(pointer)); err != nil {
		return "", err
	}
	progress.State = "COMPLETED"
	progress.Stage = "CATALOGS_READY"
	progress.Completed = 2
	progress.TICRows = len(rows)
	progress.TICSnapshotID = snapshotID
	writeProgress(ctx, store, bucket, progress)
	return snapshotID, nil
}

func numberFloat(value any) *float64 {
	if n, ok := value.(float64); ok {
		return &n
	}
	return nil
}
func numberInt64(value any) (int64, bool) {
	switch n := value.(type) {
	case float64:
		return int64(n), true
	case string:
		var parsed int64
		_, err := fmt.Sscan(n, &parsed)
		return parsed, err == nil
	}
	return 0, false
}
