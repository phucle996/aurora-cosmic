package repository

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

var factoryRunID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type FactoryHistoryClickHouse struct {
	client  *clickhouse.Client
	objects repo.ObjectRepository
}

func NewFactoryHistoryClickHouse(client *clickhouse.Client, objects repo.ObjectRepository) repo.FactoryHistoryRepository {
	return &FactoryHistoryClickHouse{client: client, objects: objects}
}

func decodeFactoryRows[T any](payload []byte) ([]T, error) {
	var response struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return nil, fmt.Errorf("decode factory history: %w", err)
	}

	rows := make([]T, 0, len(response.Data))
	for _, rawRow := range response.Data {
		normalized, err := normalizeFactoryNumericFields(rawRow)
		if err != nil {
			return nil, fmt.Errorf("decode factory history: %w", err)
		}
		var row T
		if err := json.Unmarshal(normalized, &row); err != nil {
			return nil, fmt.Errorf("decode factory history: %w", err)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// ClickHouse's JSON format quotes 64-bit integers by default.  The API keeps
// these counts as JSON numbers for the dashboard, so normalize only the
// history metric fields before unmarshalling into the domain types.
func normalizeFactoryNumericFields(rawRow json.RawMessage) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rawRow, &fields); err != nil {
		return nil, fmt.Errorf("decode history row: %w", err)
	}
	for _, field := range []string{
		"max_batch_records", "idle_flush_seconds", "pending_inputs",
		"completed_batches", "input_records", "output_rows", "indexed_rows",
		"candidate_rows", "artifact_count", "rows", "snapshot_count", "total_cadences",
		"bls_available_count", "bls_unavailable_count", "period_lt_1", "period_1_2",
		"period_2_5", "period_5_10", "period_10_20", "period_ge_20",
		"tpf_available_count", "tpf_unavailable_count", "offset_le_05", "offset_05_1",
		"offset_1_2", "offset_2_3", "offset_gt_3",
		"tic_available_count", "tic_unavailable_count", "toi_matched_count",
		"tier_full_spatial", "tier_bls_without_spatial", "tier_tic_without_bls", "tier_missing_tic",
		"toi_ephemeris_match", "toi_period_only", "toi_no_target", "toi_period_mismatch",
		"toi_ambiguous", "toi_bls_unavailable", "toi_target_unavailable", "toi_catalog_unavailable", "toi_other",
		"expected_rows", "registry_indexed_rows", "actual_candidate_rows",
	} {
		rawValue, exists := fields[field]
		if !exists || len(rawValue) == 0 || rawValue[0] != '"' {
			continue
		}
		var quoted string
		if err := json.Unmarshal(rawValue, &quoted); err != nil {
			return nil, fmt.Errorf("decode %s: %w", field, err)
		}
		value, err := strconv.ParseInt(quoted, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", field, err)
		}
		fields[field] = json.RawMessage(strconv.FormatInt(value, 10))
	}
	return json.Marshal(fields)
}

type lcFeatureAggregateRow struct {
	Rows                  int64     `json:"rows"`
	SnapshotCount         int64     `json:"snapshot_count"`
	TotalCadences         int64     `json:"total_cadences"`
	NPoints               []float64 `json:"n_points_quantiles"`
	TimeSpanDays          []float64 `json:"time_span_days"`
	MedianCadenceMinutes  []float64 `json:"median_cadence_minutes"`
	MaxGapMinutes         []float64 `json:"max_gap_minutes"`
	FluxStdPPM            []float64 `json:"flux_std_ppm"`
	FluxAmplitudePPM      []float64 `json:"flux_amplitude_ppm"`
	FluxRMSPPM            []float64 `json:"flux_rms_ppm"`
	MedianFluxErrPPM      []float64 `json:"median_flux_err_ppm"`
	BLSAvailable          int64     `json:"bls_available_count"`
	BLSUnavailable        int64     `json:"bls_unavailable_count"`
	BLSPeriodDays         []float64 `json:"bls_period_days"`
	BLSDurationHours      []float64 `json:"bls_duration_hours"`
	BLSDepthPPM           []float64 `json:"bls_depth_ppm"`
	BLSPower              []float64 `json:"bls_power_quantiles"`
	PeriodLT1             int64     `json:"period_lt_1"`
	Period1To2            int64     `json:"period_1_2"`
	Period2To5            int64     `json:"period_2_5"`
	Period5To10           int64     `json:"period_5_10"`
	Period10To20          int64     `json:"period_10_20"`
	PeriodGE20            int64     `json:"period_ge_20"`
	TPFAvailable          int64     `json:"tpf_available_count"`
	TPFUnavailable        int64     `json:"tpf_unavailable_count"`
	PixelMAD              []float64 `json:"pixel_mad_quantiles"`
	VariabilityPeakPct    []float64 `json:"variability_peak_percent"`
	TransitDeficitSum     []float64 `json:"transit_deficit_sum_quantiles"`
	CentroidOffsetPixels  []float64 `json:"centroid_offset_pixels"`
	OffsetLE05            int64     `json:"offset_le_05"`
	Offset05To1           int64     `json:"offset_05_1"`
	Offset1To2            int64     `json:"offset_1_2"`
	Offset2To3            int64     `json:"offset_2_3"`
	OffsetGT3             int64     `json:"offset_gt_3"`
	TICAvailableCount     int64     `json:"tic_available_count"`
	TICUnavailableCount   int64     `json:"tic_unavailable_count"`
	TOIMatchedCount       int64     `json:"toi_matched_count"`
	TierFullSpatial       int64     `json:"tier_full_spatial"`
	TierBLSNoSpatial      int64     `json:"tier_bls_without_spatial"`
	TierTICNoBLS          int64     `json:"tier_tic_without_bls"`
	TierMissingTIC        int64     `json:"tier_missing_tic"`
	TOIEphemerisMatch     int64     `json:"toi_ephemeris_match"`
	TOIPeriodOnly         int64     `json:"toi_period_only"`
	TOINoTarget           int64     `json:"toi_no_target"`
	TOIPeriodMismatch     int64     `json:"toi_period_mismatch"`
	TOIAmbiguous          int64     `json:"toi_ambiguous"`
	TOIBLSUnavailable     int64     `json:"toi_bls_unavailable"`
	TOITargetUnavailable  int64     `json:"toi_target_unavailable"`
	TOICatalogUnavailable int64     `json:"toi_catalog_unavailable"`
	TOIOther              int64     `json:"toi_other"`
}

func quantileSummary(values []float64) entity.QuantileSummary {
	if len(values) < 7 {
		return entity.QuantileSummary{}
	}
	return entity.QuantileSummary{Min: values[0], P05: values[1], P25: values[2], P50: values[3], P75: values[4], P95: values[5], Max: values[6]}
}

type goldManifestArtifact struct {
	Sector        int64  `json:"sector"`
	ObjectKey     string `json:"object_key"`
	RowCount      int64  `json:"row_count"`
	SizeBytes     int64  `json:"size_bytes"`
	ContentSHA256 string `json:"content_sha256"`
	ParquetSHA256 string `json:"parquet_sha256"`
}

type goldManifest struct {
	SnapshotID          string                 `json:"snapshot_id"`
	SnapshotFingerprint string                 `json:"snapshot_fingerprint"`
	Status              string                 `json:"status"`
	ManifestKey         string                 `json:"manifest_key"`
	RowCount            int64                  `json:"row_count"`
	Artifacts           []goldManifestArtifact `json:"artifacts"`
}

type goldCurrentPointer struct {
	SnapshotID          string `json:"snapshot_id"`
	SnapshotFingerprint string `json:"snapshot_fingerprint"`
	ManifestKey         string `json:"manifest_key"`
	ManifestSHA256      string `json:"manifest_sha256"`
}

type goldProjectionRegistryRow struct {
	SnapshotID          string `json:"snapshot_id"`
	ExpectedRows        int64  `json:"expected_rows"`
	RegistryIndexedRows int64  `json:"registry_indexed_rows"`
	RegistryStatus      string `json:"registry_status"`
	ManifestSHA256      string `json:"manifest_sha256"`
	ActualCandidateRows int64  `json:"actual_candidate_rows"`
}

type goldProjectionMarker struct {
	SnapshotID            string           `json:"snapshot_id"`
	ManifestSHA256        string           `json:"manifest_sha256"`
	IndexedRowCount       int64            `json:"indexed_row_count"`
	LightcurveSampleCount int64            `json:"lightcurve_sample_count"`
	TrainingCohortCounts  map[string]int64 `json:"training_cohort_counts"`
	Status                string           `json:"status"`
}

func (r *FactoryHistoryClickHouse) loadGoldProjectionEvidence(ctx context.Context, batches []entity.FactoryBatch) (*entity.GoldProjectionEvidence, error) {
	completed := make([]entity.FactoryBatch, 0, len(batches))
	snapshotLiterals := make([]string, 0, len(batches))
	for _, batch := range batches {
		if strings.ToUpper(strings.TrimSpace(batch.Status)) != "COMPLETED" || strings.TrimSpace(batch.SnapshotID) == "" {
			continue
		}
		completed = append(completed, batch)
		snapshotLiterals = append(snapshotLiterals, "'"+strings.ReplaceAll(batch.SnapshotID, "'", "''")+"'")
	}
	evidence := &entity.GoldProjectionEvidence{Snapshots: []entity.GoldProjectionSnapshotEvidence{}, Issues: []string{}}
	if len(completed) == 0 {
		return evidence, nil
	}
	query := `WITH actual AS (
		SELECT snapshot_id, count() AS actual_candidate_rows
		FROM candidate_features_current_v1 WHERE snapshot_id IN (` + strings.Join(snapshotLiterals, ",") + `)
		GROUP BY snapshot_id
	)
	SELECT registry.snapshot_id,
		argMax(registry.expected_row_count, registry.indexed_at) AS expected_rows,
		argMax(registry.indexed_row_count, registry.indexed_at) AS registry_indexed_rows,
		argMax(registry.index_status, registry.indexed_at) AS registry_status,
		argMax(registry.manifest_sha256, registry.indexed_at) AS manifest_sha256,
		ifNull(any(actual.actual_candidate_rows), 0) AS actual_candidate_rows
	FROM gold_snapshots_v1 AS registry
	LEFT JOIN actual USING (snapshot_id)
	WHERE registry.snapshot_id IN (` + strings.Join(snapshotLiterals, ",") + `)
	GROUP BY registry.snapshot_id FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query Gold analytical projection evidence: %w", err)
	}
	registryRows, err := decodeFactoryRows[goldProjectionRegistryRow](payload)
	if err != nil {
		return nil, err
	}
	registryBySnapshot := make(map[string]goldProjectionRegistryRow, len(registryRows))
	for _, row := range registryRows {
		registryBySnapshot[row.SnapshotID] = row
	}
	for _, batch := range completed {
		evidence.SnapshotCount++
		registry, registryPresent := registryBySnapshot[batch.SnapshotID]
		if !registryPresent {
			evidence.Issues = append(evidence.Issues, "ClickHouse snapshot registry missing for "+batch.SnapshotID)
		}
		if strings.ToUpper(registry.RegistryStatus) == "READY" {
			evidence.RegistryReadySnapshots++
		}
		marker := goldProjectionMarker{TrainingCohortCounts: map[string]int64{}}
		markerPresent := false
		if r.objects != nil {
			markerKey := "gold/snapshots/" + batch.SnapshotID + "/projections/clickhouse-v1.json"
			if markerBytes, markerErr := r.objects.GetObject(ctx, markerKey); markerErr == nil {
				if json.Unmarshal(markerBytes, &marker) == nil {
					markerPresent = true
				} else {
					evidence.Issues = append(evidence.Issues, "Projection marker JSON invalid for "+batch.SnapshotID)
				}
			} else {
				evidence.Issues = append(evidence.Issues, "Projection marker missing for "+batch.SnapshotID)
			}
		}
		manifestBinding := markerPresent && marker.SnapshotID == batch.SnapshotID && marker.ManifestSHA256 == batch.ManifestSHA256 && registry.ManifestSHA256 == batch.ManifestSHA256
		if manifestBinding && strings.ToUpper(marker.Status) == "READY" {
			evidence.MarkerVerifiedSnapshots++
		} else if markerPresent {
			evidence.Issues = append(evidence.Issues, "Projection marker binding mismatch for "+batch.SnapshotID)
		}
		expectedRows := registry.ExpectedRows
		if expectedRows == 0 {
			expectedRows = batch.CandidateRows
		}
		rowParity := registryPresent && markerPresent && expectedRows == batch.CandidateRows && batch.IndexedRows == expectedRows && registry.RegistryIndexedRows == expectedRows && registry.ActualCandidateRows == expectedRows && marker.IndexedRowCount == expectedRows
		if rowParity {
			evidence.RowParitySnapshots++
		} else {
			evidence.Issues = append(evidence.Issues, "Projection row parity mismatch for "+batch.SnapshotID)
		}
		cohortRows := marker.TrainingCohortCounts["positive"] + marker.TrainingCohortCounts["negative"] + marker.TrainingCohortCounts["unresolved"]
		snapshot := entity.GoldProjectionSnapshotEvidence{
			SnapshotID: batch.SnapshotID, ExpectedRows: expectedRows, LedgerIndexedRows: batch.IndexedRows,
			RegistryIndexedRows: registry.RegistryIndexedRows, ActualCandidateRows: registry.ActualCandidateRows,
			LightcurveSampleRows: marker.LightcurveSampleCount,
			TrainingPositiveRows: marker.TrainingCohortCounts["positive"], TrainingNegativeRows: marker.TrainingCohortCounts["negative"],
			TrainingUnresolvedRows: marker.TrainingCohortCounts["unresolved"], RegistryStatus: registry.RegistryStatus,
			MarkerStatus: marker.Status, ManifestBindingValid: manifestBinding, RowParityValid: rowParity,
		}
		evidence.ExpectedRows += expectedRows
		evidence.IndexedRows += registry.RegistryIndexedRows
		evidence.ActualCandidateRows += registry.ActualCandidateRows
		evidence.LightcurveSampleRows += marker.LightcurveSampleCount
		evidence.TrainingCohortRows += cohortRows
		evidence.Snapshots = append(evidence.Snapshots, snapshot)
	}
	return evidence, nil
}

func (r *FactoryHistoryClickHouse) loadGoldMaterializationEvidence(ctx context.Context, batches []entity.FactoryBatch) *entity.GoldMaterializationEvidence {
	evidence := &entity.GoldMaterializationEvidence{Artifacts: []entity.GoldArtifactEvidence{}, Issues: []string{}}
	for _, batch := range batches {
		evidence.BatchCount++
		switch strings.ToUpper(strings.TrimSpace(batch.Status)) {
		case "COMPLETED":
			evidence.CompletedBatches++
		case "FAILED", "ERROR":
			evidence.FailedBatches++
		}
		if strings.ToUpper(strings.TrimSpace(batch.Status)) != "COMPLETED" || strings.TrimSpace(batch.ManifestKey) == "" {
			continue
		}
		if r.objects == nil {
			evidence.Issues = append(evidence.Issues, "Object repository unavailable for "+batch.SnapshotID)
			continue
		}
		manifestBytes, err := r.objects.GetObject(ctx, batch.ManifestKey)
		if err != nil {
			evidence.Issues = append(evidence.Issues, "Manifest unavailable for "+batch.SnapshotID)
			continue
		}
		manifestDigest := fmt.Sprintf("%x", sha256.Sum256(manifestBytes))
		if batch.ManifestSHA256 != "" && manifestDigest == batch.ManifestSHA256 {
			evidence.ManifestVerifiedBatches++
		} else {
			evidence.Issues = append(evidence.Issues, "Manifest SHA mismatch for "+batch.SnapshotID)
		}
		var manifest goldManifest
		if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
			evidence.Issues = append(evidence.Issues, "Manifest JSON invalid for "+batch.SnapshotID)
			continue
		}
		objects, err := r.objects.ListObjects(ctx, "gold/snapshots/"+batch.SnapshotID+"/data/")
		if err != nil {
			evidence.Issues = append(evidence.Issues, "Artifact inventory unavailable for "+batch.SnapshotID)
		}
		objectSizes := make(map[string]int64, len(objects))
		for _, object := range objects {
			objectSizes[object.Key] = object.Size
		}
		var accountedRows int64
		for _, artifact := range manifest.Artifacts {
			accountedRows += artifact.RowCount
			evidence.Rows += artifact.RowCount
			evidence.ArtifactCount++
			evidence.TotalBytes += artifact.SizeBytes
			storedSize, present := objectSizes[artifact.ObjectKey]
			sizeVerified := present && storedSize == artifact.SizeBytes
			checksumsDeclared := len(artifact.ContentSHA256) == 64 && len(artifact.ParquetSHA256) == 64
			if sizeVerified {
				evidence.ObjectVerifiedArtifacts++
			}
			if checksumsDeclared {
				evidence.ChecksumDeclaredArtifacts++
			}
			bytesPerRow := 0.0
			if artifact.RowCount > 0 {
				bytesPerRow = float64(artifact.SizeBytes) / float64(artifact.RowCount)
			}
			evidence.Artifacts = append(evidence.Artifacts, entity.GoldArtifactEvidence{
				SnapshotID: batch.SnapshotID, Sector: artifact.Sector, ObjectKey: artifact.ObjectKey,
				RowCount: artifact.RowCount, SizeBytes: artifact.SizeBytes, BytesPerRow: bytesPerRow,
				ObjectPresent: present, SizeVerified: sizeVerified, ChecksumsDeclared: checksumsDeclared,
			})
		}
		if accountedRows == manifest.RowCount && manifest.RowCount == batch.CandidateRows {
			evidence.RowAccountingVerifiedBatches++
		} else {
			evidence.Issues = append(evidence.Issues, "Row accounting mismatch for "+batch.SnapshotID)
		}
	}
	return evidence
}

func (r *FactoryHistoryClickHouse) loadGoldCommitEvidence(
	ctx context.Context,
	batches []entity.FactoryBatch,
	materialization *entity.GoldMaterializationEvidence,
	projection *entity.GoldProjectionEvidence,
) *entity.GoldCommitEvidence {
	evidence := &entity.GoldCommitEvidence{Snapshots: []entity.GoldCommitSnapshotEvidence{}, Issues: []string{}}
	artifactsBySnapshot := make(map[string][]entity.GoldArtifactEvidence)
	if materialization != nil {
		for _, artifact := range materialization.Artifacts {
			artifactsBySnapshot[artifact.SnapshotID] = append(artifactsBySnapshot[artifact.SnapshotID], artifact)
		}
	}
	projectionBySnapshot := make(map[string]entity.GoldProjectionSnapshotEvidence)
	if projection != nil {
		for _, snapshot := range projection.Snapshots {
			projectionBySnapshot[snapshot.SnapshotID] = snapshot
		}
	}

	current := goldCurrentPointer{}
	currentObserved := false
	if r.objects != nil {
		if pointerBytes, err := r.objects.GetObject(ctx, "gold/current/CANDIDATE.json"); err == nil {
			if json.Unmarshal(pointerBytes, &current) == nil {
				currentObserved = true
			} else {
				evidence.Issues = append(evidence.Issues, "Current Candidate pointer JSON is invalid")
			}
		}
	}

	for _, batch := range batches {
		if strings.ToUpper(strings.TrimSpace(batch.Status)) != "COMPLETED" || strings.TrimSpace(batch.SnapshotID) == "" {
			continue
		}
		evidence.SnapshotCount++
		point := entity.GoldCommitSnapshotEvidence{
			SnapshotID: batch.SnapshotID, CompletedAt: batch.CompletedAt, BatchStatus: batch.Status,
			BatchRows: batch.CandidateRows, ArtifactCount: batch.ArtifactCount,
		}
		if r.objects == nil || strings.TrimSpace(batch.ManifestKey) == "" {
			evidence.Issues = append(evidence.Issues, "Commit manifest unavailable for "+batch.SnapshotID)
			evidence.Snapshots = append(evidence.Snapshots, point)
			continue
		}

		manifestBytes, err := r.objects.GetObject(ctx, batch.ManifestKey)
		if err != nil {
			evidence.Issues = append(evidence.Issues, "Commit manifest unavailable for "+batch.SnapshotID)
			evidence.Snapshots = append(evidence.Snapshots, point)
			continue
		}
		manifestDigest := fmt.Sprintf("%x", sha256.Sum256(manifestBytes))
		point.ManifestSHAValid = batch.ManifestSHA256 != "" && manifestDigest == batch.ManifestSHA256
		var manifest goldManifest
		if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
			evidence.Issues = append(evidence.Issues, "Commit manifest JSON invalid for "+batch.SnapshotID)
			evidence.Snapshots = append(evidence.Snapshots, point)
			continue
		}
		point.ManifestStatus = manifest.Status
		point.ManifestRows = manifest.RowCount
		point.ArtifactCount = int64(len(manifest.Artifacts))
		point.FingerprintValid = manifest.SnapshotID == batch.SnapshotID &&
			manifest.SnapshotFingerprint == batch.SnapshotFingerprint &&
			manifest.ManifestKey == batch.ManifestKey
		var manifestRows int64
		for _, artifact := range manifest.Artifacts {
			manifestRows += artifact.RowCount
		}
		point.RowAccountingValid = manifestRows == manifest.RowCount &&
			manifest.RowCount == batch.CandidateRows && int64(len(manifest.Artifacts)) == batch.ArtifactCount

		observedArtifacts := artifactsBySnapshot[batch.SnapshotID]
		point.ArtifactIntegrityValid = int64(len(observedArtifacts)) == batch.ArtifactCount
		for _, artifact := range observedArtifacts {
			point.ArtifactIntegrityValid = point.ArtifactIntegrityValid && artifact.ObjectPresent && artifact.SizeVerified && artifact.ChecksumsDeclared
		}

		projectionPoint, projectionObserved := projectionBySnapshot[batch.SnapshotID]
		point.ProjectionStatus = projectionPoint.RegistryStatus
		point.ProjectedRows = projectionPoint.ActualCandidateRows
		point.ProjectionReady = projectionObserved && strings.ToUpper(projectionPoint.RegistryStatus) == "READY" &&
			strings.ToUpper(projectionPoint.MarkerStatus) == "READY" && projectionPoint.ManifestBindingValid && projectionPoint.RowParityValid
		point.Current = currentObserved && current.SnapshotID == batch.SnapshotID &&
			current.SnapshotFingerprint == batch.SnapshotFingerprint && current.ManifestKey == batch.ManifestKey &&
			current.ManifestSHA256 == batch.ManifestSHA256
		point.EndToEndValid = strings.ToUpper(manifest.Status) == "COMMITTED" && point.ManifestSHAValid &&
			point.FingerprintValid && point.ArtifactIntegrityValid && point.RowAccountingValid && point.ProjectionReady

		if strings.ToUpper(manifest.Status) == "COMMITTED" {
			evidence.CommittedSnapshots++
		}
		if point.EndToEndValid {
			evidence.EndToEndVerifiedSnapshots++
		} else {
			evidence.Issues = append(evidence.Issues, "End-to-end commit gates incomplete for "+batch.SnapshotID)
		}
		if point.Current {
			evidence.ActiveCurrentSnapshots++
		}
		evidence.Rows += manifest.RowCount
		evidence.Artifacts += int64(len(manifest.Artifacts))
		evidence.Snapshots = append(evidence.Snapshots, point)
	}
	return evidence
}

func (r *FactoryHistoryClickHouse) loadScientificEvidence(ctx context.Context, batches []entity.FactoryBatch) (*entity.FactoryScientificEvidence, error) {
	snapshotSet := make(map[string]struct{})
	for _, batch := range batches {
		if snapshotID := strings.TrimSpace(batch.SnapshotID); snapshotID != "" {
			snapshotSet[snapshotID] = struct{}{}
		}
	}
	if len(snapshotSet) == 0 {
		return nil, nil
	}
	snapshots := make([]string, 0, len(snapshotSet))
	for snapshotID := range snapshotSet {
		snapshots = append(snapshots, "'"+strings.ReplaceAll(snapshotID, "'", "''")+"'")
	}
	quantiles := "quantilesExact(0, 0.05, 0.25, 0.50, 0.75, 0.95, 1)"
	quantilesIf := "quantilesExactIf(0, 0.05, 0.25, 0.50, 0.75, 0.95, 1)"
	query := `SELECT count() AS rows, uniqExact(snapshot_id) AS snapshot_count,
		sum(n_points) AS total_cadences,
		` + quantiles + `(toFloat64(n_points)) AS n_points_quantiles,
		` + quantiles + `(time_span) AS time_span_days,
		` + quantiles + `(median_cadence * 1440) AS median_cadence_minutes,
		` + quantiles + `(max_gap * 1440) AS max_gap_minutes,
		` + quantiles + `(flux_std * 1000000) AS flux_std_ppm,
		` + quantiles + `(flux_amplitude * 1000000) AS flux_amplitude_ppm,
		` + quantiles + `(flux_rms * 1000000) AS flux_rms_ppm,
		` + quantiles + `(ifNull(median_flux_err, 0) * 1000000) AS median_flux_err_ppm,
		countIf(bls_available = 1) AS bls_available_count,
		countIf(bls_available = 0) AS bls_unavailable_count,
		` + quantilesIf + `(ifNull(bls_period, 0), bls_available = 1 AND isNotNull(bls_period)) AS bls_period_days,
		` + quantilesIf + `(ifNull(bls_duration, 0) * 24, bls_available = 1 AND isNotNull(bls_duration)) AS bls_duration_hours,
		` + quantilesIf + `(ifNull(bls_depth, 0) * 1000000, bls_available = 1 AND isNotNull(bls_depth)) AS bls_depth_ppm,
		` + quantilesIf + `(ifNull(bls_power, 0), bls_available = 1 AND isNotNull(bls_power)) AS bls_power_quantiles,
		countIf(bls_available = 1 AND bls_period < 1) AS period_lt_1,
		countIf(bls_available = 1 AND bls_period >= 1 AND bls_period < 2) AS period_1_2,
		countIf(bls_available = 1 AND bls_period >= 2 AND bls_period < 5) AS period_2_5,
		countIf(bls_available = 1 AND bls_period >= 5 AND bls_period < 10) AS period_5_10,
		countIf(bls_available = 1 AND bls_period >= 10 AND bls_period < 20) AS period_10_20,
		countIf(bls_available = 1 AND bls_period >= 20) AS period_ge_20,
		countIf(transit_evidence_available = 1) AS tpf_available_count,
		countIf(transit_evidence_available = 0) AS tpf_unavailable_count,
		` + quantilesIf + `(ifNull(pixel_mad_median, 0), isNotNull(pixel_mad_median)) AS pixel_mad_quantiles,
		` + quantilesIf + `(ifNull(variability_peak_fraction, 0) * 100, isNotNull(variability_peak_fraction)) AS variability_peak_percent,
		` + quantilesIf + `(ifNull(transit_deficit_sum, 0), transit_evidence_available = 1 AND isNotNull(transit_deficit_sum)) AS transit_deficit_sum_quantiles,
		` + quantilesIf + `(ifNull(transit_deficit_center_offset_pixels, 0), transit_evidence_available = 1 AND isNotNull(transit_deficit_center_offset_pixels)) AS centroid_offset_pixels,
		countIf(transit_evidence_available = 1 AND transit_deficit_center_offset_pixels <= 0.5) AS offset_le_05,
		countIf(transit_evidence_available = 1 AND transit_deficit_center_offset_pixels > 0.5 AND transit_deficit_center_offset_pixels <= 1) AS offset_05_1,
		countIf(transit_evidence_available = 1 AND transit_deficit_center_offset_pixels > 1 AND transit_deficit_center_offset_pixels <= 2) AS offset_1_2,
		countIf(transit_evidence_available = 1 AND transit_deficit_center_offset_pixels > 2 AND transit_deficit_center_offset_pixels <= 3) AS offset_2_3,
		countIf(transit_evidence_available = 1 AND transit_deficit_center_offset_pixels > 3) AS offset_gt_3,
		countIf(tic_available = 1) AS tic_available_count,
		countIf(tic_available = 0) AS tic_unavailable_count,
		countIf(toi_match_status IN ('EPHEMERIS_MATCH', 'PERIOD_ONLY')) AS toi_matched_count,
		countIf(tic_available = 1 AND bls_available = 1 AND transit_evidence_available = 1) AS tier_full_spatial,
		countIf(tic_available = 1 AND bls_available = 1 AND transit_evidence_available = 0) AS tier_bls_without_spatial,
		countIf(tic_available = 1 AND bls_available = 0) AS tier_tic_without_bls,
		countIf(tic_available = 0) AS tier_missing_tic,
		countIf(toi_match_status = 'EPHEMERIS_MATCH') AS toi_ephemeris_match,
		countIf(toi_match_status = 'PERIOD_ONLY') AS toi_period_only,
		countIf(toi_match_status = 'NO_TOI_FOR_TARGET') AS toi_no_target,
		countIf(toi_match_status = 'PERIOD_MISMATCH') AS toi_period_mismatch,
		countIf(toi_match_status = 'AMBIGUOUS') AS toi_ambiguous,
		countIf(toi_match_status = 'BLS_UNAVAILABLE') AS toi_bls_unavailable,
		countIf(toi_match_status = 'TARGET_ID_UNAVAILABLE') AS toi_target_unavailable,
		countIf(toi_match_status = 'CATALOG_UNAVAILABLE') AS toi_catalog_unavailable,
		countIf(toi_match_status NOT IN ('EPHEMERIS_MATCH','PERIOD_ONLY','NO_TOI_FOR_TARGET','PERIOD_MISMATCH','AMBIGUOUS','BLS_UNAVAILABLE','TARGET_ID_UNAVAILABLE','CATALOG_UNAVAILABLE')) AS toi_other
		FROM candidate_features_current_v1
		WHERE snapshot_id IN (` + strings.Join(snapshots, ",") + `)
		HAVING count() > 0 FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query scientific run evidence: %w", err)
	}
	rows, err := decodeFactoryRows[lcFeatureAggregateRow](payload)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	row := rows[0]
	lcFeatures := &entity.LCFeatureEvidence{
		Rows: row.Rows, SnapshotCount: row.SnapshotCount, TotalCadences: row.TotalCadences,
		NPoints: quantileSummary(row.NPoints), TimeSpanDays: quantileSummary(row.TimeSpanDays),
		MedianCadenceMinutes: quantileSummary(row.MedianCadenceMinutes), MaxGapMinutes: quantileSummary(row.MaxGapMinutes),
		FluxStdPPM: quantileSummary(row.FluxStdPPM), FluxAmplitudePPM: quantileSummary(row.FluxAmplitudePPM),
		FluxRMSPPM: quantileSummary(row.FluxRMSPPM), MedianFluxErrPPM: quantileSummary(row.MedianFluxErrPPM),
	}
	blsSearch := &entity.BLSSearchEvidence{
		Evaluated: row.Rows, Available: row.BLSAvailable, Unavailable: row.BLSUnavailable,
		PeriodDays: quantileSummary(row.BLSPeriodDays), DurationHours: quantileSummary(row.BLSDurationHours),
		DepthPPM: quantileSummary(row.BLSDepthPPM), Power: quantileSummary(row.BLSPower),
		PeriodHistogram: []entity.HistogramBin{
			{Label: "<1 d", Count: row.PeriodLT1}, {Label: "1–2 d", Count: row.Period1To2},
			{Label: "2–5 d", Count: row.Period2To5}, {Label: "5–10 d", Count: row.Period5To10},
			{Label: "10–20 d", Count: row.Period10To20}, {Label: "≥20 d", Count: row.PeriodGE20},
		},
	}
	tpfSpatial := &entity.TPFSpatialEvidence{
		Evaluated: row.Rows, Available: row.TPFAvailable, Unavailable: row.TPFUnavailable,
		PixelMAD: quantileSummary(row.PixelMAD), VariabilityPeakPercent: quantileSummary(row.VariabilityPeakPct),
		TransitDeficitSum: quantileSummary(row.TransitDeficitSum), CentroidOffsetPixels: quantileSummary(row.CentroidOffsetPixels),
		CentroidOffsetHistogram: []entity.HistogramBin{
			{Label: "≤0.5 px", Count: row.OffsetLE05}, {Label: "0.5–1 px", Count: row.Offset05To1},
			{Label: "1–2 px", Count: row.Offset1To2}, {Label: "2–3 px", Count: row.Offset2To3},
			{Label: ">3 px", Count: row.OffsetGT3},
		},
	}
	candidateAssembly := &entity.CandidateAssemblyEvidence{
		Rows: row.Rows, TICAvailable: row.TICAvailableCount, TICUnavailable: row.TICUnavailableCount,
		BLSAvailable: row.BLSAvailable, TransitEvidence: row.TPFAvailable, TOIMatched: row.TOIMatchedCount,
		EvidenceTierHistogram: []entity.HistogramBin{
			{Label: "TIC + BLS + spatial", Count: row.TierFullSpatial},
			{Label: "TIC + BLS", Count: row.TierBLSNoSpatial},
			{Label: "TIC only", Count: row.TierTICNoBLS},
			{Label: "Missing TIC", Count: row.TierMissingTIC},
		},
		TOIMatchStatusHistogram: []entity.HistogramBin{
			{Label: "Ephemeris match", Count: row.TOIEphemerisMatch}, {Label: "Period only", Count: row.TOIPeriodOnly},
			{Label: "No TOI for target", Count: row.TOINoTarget}, {Label: "Period mismatch", Count: row.TOIPeriodMismatch},
			{Label: "Ambiguous", Count: row.TOIAmbiguous}, {Label: "BLS unavailable", Count: row.TOIBLSUnavailable},
			{Label: "Target ID unavailable", Count: row.TOITargetUnavailable}, {Label: "Catalog unavailable", Count: row.TOICatalogUnavailable},
			{Label: "Other", Count: row.TOIOther},
		},
	}
	return &entity.FactoryScientificEvidence{LCFeatures: lcFeatures, BLSSearch: blsSearch, TPFSpatial: tpfSpatial, CandidateAssembly: candidateAssembly}, nil
}

func factoryRunColumns() string {
	return `pipeline, run_id,
		argMax(runs.mode, runs.updated_at) AS mode, argMax(runs.status, runs.updated_at) AS status,
		toString(min(runs.started_at)) AS started_at,
		toString(argMax(runs.finished_at, runs.updated_at)) AS finished_at,
		argMax(runs.max_batch_records, runs.updated_at) AS max_batch_records,
		argMax(runs.idle_flush_seconds, runs.updated_at) AS idle_flush_seconds,
		argMax(runs.pending_inputs, runs.updated_at) AS pending_inputs,
		countIf(latest_batches.batch_id != '') AS completed_batches,
		coalesce(sum(latest_batches.input_records), 0) AS input_records,
		coalesce(sum(latest_batches.candidate_rows), 0) AS output_rows,
		coalesce(sum(latest_batches.indexed_rows), 0) AS indexed_rows,
		argMax(runs.last_snapshot_id, runs.updated_at) AS last_snapshot_id,
		argMax(runs.last_error, runs.updated_at) AS last_error,
		toString(max(runs.updated_at)) AS updated_at`
}

func (r *FactoryHistoryClickHouse) ListRuns(ctx context.Context, pipeline string, limit int) ([]entity.FactoryRun, error) {
	if r == nil || r.client == nil {
		return nil, fmt.Errorf("factory history client is unavailable")
	}
	where := ""
	if pipeline != "" {
		where = "WHERE runs.pipeline = '" + pipeline + "'"
	}
	query := `WITH latest_batches AS (
		SELECT run_id, batch_id, argMax(input_records, updated_at) AS input_records,
		argMax(candidate_rows, updated_at) AS candidate_rows,
		argMax(indexed_rows, updated_at) AS indexed_rows
		FROM pipeline_batches_v1 GROUP BY run_id, batch_id
	)
	SELECT ` + factoryRunColumns() + `
	FROM pipeline_runs_v1 AS runs
	LEFT JOIN latest_batches USING (run_id)
	` + where + `
	GROUP BY pipeline, run_id
	ORDER BY updated_at DESC LIMIT ` + fmt.Sprintf("%d", limit) + ` FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	return decodeFactoryRows[entity.FactoryRun](payload)
}

func (r *FactoryHistoryClickHouse) GetRun(ctx context.Context, runID string) (*entity.FactoryRunDetail, error) {
	if r == nil || r.client == nil {
		return nil, fmt.Errorf("factory history client is unavailable")
	}
	if !factoryRunID.MatchString(runID) {
		return nil, fmt.Errorf("invalid run_id")
	}
	runs, err := r.ListRuns(ctx, "", 100)
	if err != nil {
		return nil, err
	}
	var selected *entity.FactoryRun
	for index := range runs {
		if runs[index].RunID == runID {
			selected = &runs[index]
			break
		}
	}
	if selected == nil {
		return nil, repo.ErrNotFound
	}
	query := `SELECT batch_id, argMax(mode, updated_at) AS mode,
		argMax(status, updated_at) AS status, toString(min(started_at)) AS started_at,
		toString(argMax(completed_at, updated_at)) AS completed_at,
		argMax(input_records, updated_at) AS input_records,
		argMax(candidate_rows, updated_at) AS candidate_rows,
		argMax(artifact_count, updated_at) AS artifact_count,
		argMax(indexed_rows, updated_at) AS indexed_rows,
		argMax(snapshot_id, updated_at) AS snapshot_id,
		argMax(snapshot_fingerprint, updated_at) AS snapshot_fingerprint,
		argMax(manifest_key, updated_at) AS manifest_key,
		argMax(manifest_sha256, updated_at) AS manifest_sha256,
		argMax(error, updated_at) AS error
		FROM pipeline_batches_v1 WHERE run_id = '` + strings.ReplaceAll(runID, "'", "") + `'
		GROUP BY batch_id ORDER BY started_at ASC FORMAT JSON`
	payload, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	batches, err := decodeFactoryRows[entity.FactoryBatch](payload)
	if err != nil {
		return nil, err
	}
	componentsQuery := `SELECT component_id, status, toString(occurred_at) AS occurred_at,
		input_records, output_rows, indexed_rows, snapshot_id, error
		FROM pipeline_component_events_v1 WHERE run_id = '` + strings.ReplaceAll(runID, "'", "") + `'
		ORDER BY occurred_at ASC FORMAT JSON`
	payload, err = r.client.Query(ctx, componentsQuery)
	if err != nil {
		return nil, err
	}
	components, err := decodeFactoryRows[entity.FactoryComponentEvent](payload)
	if err != nil {
		return nil, err
	}
	scientificEvidence, err := r.loadScientificEvidence(ctx, batches)
	if err != nil {
		return nil, err
	}
	materialization := r.loadGoldMaterializationEvidence(ctx, batches)
	projection, err := r.loadGoldProjectionEvidence(ctx, batches)
	if err != nil {
		return nil, err
	}
	if scientificEvidence == nil {
		scientificEvidence = &entity.FactoryScientificEvidence{}
	}
	scientificEvidence.GoldMaterialization = materialization
	scientificEvidence.GoldProjection = projection
	scientificEvidence.GoldCommit = r.loadGoldCommitEvidence(ctx, batches, materialization, projection)
	return &entity.FactoryRunDetail{Run: *selected, Batches: batches, Components: components, ScientificEvidence: scientificEvidence}, nil
}
