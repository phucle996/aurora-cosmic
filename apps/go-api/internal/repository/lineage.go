package repository

import (
	"context"
	"encoding/json"
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

type clickHouseLineageRow struct {
	SourceProductID string   `json:"source_product_id"`
	SilverObjectKey string   `json:"silver_object_key"`
	SnapshotID      string   `json:"snapshot_id"`
	Datasets        []string `json:"datasets"`
	Status          string   `json:"status"`
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
			sourceIDs = append(sourceIDs, "'"+escapeSQL(sourceID)+"'")
		}
		if silverKey != "" {
			bySilverKey[silverKey] = append(bySilverKey[silverKey], index)
			silverKeys = append(silverKeys, "'"+escapeSQL(silverKey)+"'")
		}
	}

	if len(lookups) == 0 || (len(sourceIDs) == 0 && len(silverKeys) == 0) {
		return resolutions, nil
	}

	predicates := make([]string, 0, 2)
	if len(sourceIDs) > 0 {
		predicates = append(predicates, fmt.Sprintf("source_product_id IN (%s)", strings.Join(sourceIDs, ", ")))
	}
	if len(silverKeys) > 0 {
		predicates = append(predicates, fmt.Sprintf("silver_object_key IN (%s)", strings.Join(silverKeys, ", ")))
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
	WHERE rank = 1
	FORMAT JSON`, strings.Join(predicates, " OR "))

	body, err := r.client.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query gold lineage inputs: %w", err)
	}

	var response struct {
		Data []clickHouseLineageRow `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode gold lineage inputs: %w", err)
	}

	for _, row := range response.Data {
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
