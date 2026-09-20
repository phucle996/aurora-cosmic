package repository

import (
	"context"
	"fmt"
	"strings"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
)

type LineageClickHouse struct {
	client *clickhouse.Client
}

func NewLineageClickHouse(client *clickhouse.Client) repo.LineageRepository {
	return &LineageClickHouse{client: client}
}

func (r *LineageClickHouse) TraceLineage(ctx context.Context, lookups []entity.LineageLookup) ([]entity.LineageResolution, error) {
	resolutions := make([]entity.LineageResolution, len(lookups))
	bySource := make(map[string][]int)
	bySilverKey := make(map[string][]int)
	sourceIDs := make([]string, 0, len(lookups))
	silverKeys := make([]string, 0, len(lookups))

	for index, lookup := range lookups {
		sourceID := strings.TrimSpace(lookup.SourceProductID)
		silverKey := strings.TrimSpace(lookup.SilverObjectKey)
		resolutions[index] = entity.LineageResolution{
			SourceProductID: sourceID,
			SilverObjectKey: silverKey,
			Status:          "PENDING",
		}
		if sourceID != "" {
			bySource[sourceID] = append(bySource[sourceID], index)
			sourceIDs = append(sourceIDs, sourceID)
		}
		if silverKey != "" {
			bySilverKey[silverKey] = append(bySilverKey[silverKey], index)
			silverKeys = append(silverKeys, silverKey)
		}
	}

	if len(lookups) == 0 || (len(sourceIDs) == 0 && len(silverKeys) == 0) {
		return resolutions, nil
	}

	predicates := make([]string, 0, 2)
	var args []any
	if len(sourceIDs) > 0 {
		predicates = append(predicates, "source_product_id IN (?)")
		args = append(args, sourceIDs)
	}
	if len(silverKeys) > 0 {
		predicates = append(predicates, "silver_object_key IN (?)")
		args = append(args, silverKeys)
	}

	// CTE-first query: trace the latest committed Gold snapshot for each requested Silver input
	query := fmt.Sprintf(`WITH matched_inputs AS (
		SELECT
			source_product_id,
			silver_object_key,
			snapshot_id,
			datasets,
			status,
			committed_at,
			ROW_NUMBER() OVER (PARTITION BY source_product_id, silver_object_key ORDER BY committed_at DESC) AS rank
		FROM gold_lineage_inputs_v1
		WHERE %s
	)
	SELECT
		source_product_id,
		silver_object_key,
		snapshot_id,
		datasets,
		status
	FROM matched_inputs
	WHERE rank = 1`, strings.Join(predicates, " OR "))

	var rows []entity.GoldLineageInput
	if err := r.client.Select(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("query gold lineage inputs: %w", err)
	}

	for _, row := range rows {
		matchedIndices := append([]int(nil), bySource[row.SourceProductID]...)
		matchedIndices = append(matchedIndices, bySilverKey[row.SilverObjectKey]...)
		for _, index := range matchedIndices {
			if resolutions[index].Status == "EXTRACTED" {
				continue
			}
			status := row.Status
			if status == "" {
				status = "EXTRACTED"
			}
			resolutions[index].Status = status
			resolutions[index].SnapshotID = row.SnapshotID
			resolutions[index].Datasets = row.Datasets
		}
	}

	return resolutions, nil
}
