package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go-api/infra/clickhouse"
	"go-api/internal/domain/repo"
)

type CatalogClickHouse struct {
	client *clickhouse.Client
}

func NewCatalogClickHouse(client *clickhouse.Client) repo.LakehouseCatalogRepository {
	return &CatalogClickHouse{client: client}
}

func (r *CatalogClickHouse) EnsureSchema(ctx context.Context) error {
	schema := `
CREATE TABLE IF NOT EXISTS aurora.lakehouse_objects (
    tier LowCardinality(String),
    object_key String,
    size_bytes Int64,
    etag String,
    sector Int32,
    tic_id Int64,
    product_type LowCardinality(String),
    last_modified DateTime,
    indexed_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_modified)
PRIMARY KEY (tier, sector, tic_id, object_key)
ORDER BY (tier, sector, tic_id, object_key);
`
	return r.client.Exec(ctx, schema)
}

func (r *CatalogClickHouse) UpsertObjects(ctx context.Context, objects []repo.CatalogObject) error {
	if len(objects) == 0 {
		return nil
	}

	var sb strings.Builder
	sb.WriteString("INSERT INTO aurora.lakehouse_objects (tier, object_key, size_bytes, etag, sector, tic_id, product_type, last_modified) VALUES ")

	first := true
	for _, obj := range objects {
		if !first {
			sb.WriteString(", ")
		}
		first = false

		cleanEtag := strings.ReplaceAll(obj.ETag, "'", "")
		cleanKey := strings.ReplaceAll(obj.ObjectKey, "'", "\\'")
		timeStr := obj.LastModified.UTC().Format("2006-01-02 15:04:05")

		sb.WriteString(fmt.Sprintf("('%s', '%s', %d, '%s', %d, %d, '%s', '%s')",
			obj.Tier, cleanKey, obj.SizeBytes, cleanEtag, obj.Sector, obj.TICID, obj.ProductType, timeStr))
	}

	return r.client.Exec(ctx, sb.String())
}

var (
	ticRegex    = regexp.MustCompile(`tic=(\d+)`)
	sectorRegex = regexp.MustCompile(`sector=(\d+)`)
)

func ParseCatalogObject(key string, size int64, etag string, modTime time.Time) repo.CatalogObject {
	tier := "bronze"
	productType := "fits_lightcurve"

	if strings.HasPrefix(key, "silver/") {
		tier = "silver"
		if strings.Contains(key, "tpf") {
			productType = "parquet_tpf"
		} else {
			productType = "parquet_lightcurve"
		}
	} else if strings.HasPrefix(key, "gold/") {
		tier = "gold"
		productType = "gold_features"
	}

	var sector int32 = 42
	if m := sectorRegex.FindStringSubmatch(key); len(m) > 1 {
		if parsed, err := strconv.Atoi(m[1]); err == nil {
			sector = int32(parsed)
		}
	}

	var ticID int64 = 0
	if m := ticRegex.FindStringSubmatch(key); len(m) > 1 {
		if parsed, err := strconv.ParseInt(m[1], 10, 64); err == nil {
			ticID = parsed
		}
	}

	cleanEtag := strings.Trim(etag, "\"")

	return repo.CatalogObject{
		Tier:         tier,
		ObjectKey:    key,
		SizeBytes:    size,
		ETag:         cleanEtag,
		Sector:       sector,
		TICID:        ticID,
		ProductType:  productType,
		LastModified: modTime,
	}
}

type countResponse struct {
	Data []struct {
		Total      string `json:"total"`
		TotalBytes string `json:"total_bytes"`
	} `json:"data"`
}

func (r *CatalogClickHouse) CountObjects(ctx context.Context, tier string) (int64, int64, error) {
	query := fmt.Sprintf("SELECT toString(count()) AS total, toString(sum(size_bytes)) AS total_bytes FROM aurora.lakehouse_objects WHERE tier = '%s' FORMAT JSON", tier)
	data, err := r.client.Query(ctx, query)
	if err != nil {
		return 0, 0, err
	}

	var resp countResponse
	if err := json.Unmarshal(data, &resp); err != nil || len(resp.Data) == 0 {
		return 0, 0, nil
	}

	total, _ := strconv.ParseInt(resp.Data[0].Total, 10, 64)
	totalBytes, _ := strconv.ParseInt(resp.Data[0].TotalBytes, 10, 64)
	return total, totalBytes, nil
}

type listResponse struct {
	Data []struct {
		Tier         string `json:"tier"`
		ObjectKey    string `json:"object_key"`
		SizeBytes    string `json:"size_bytes"`
		ETag         string `json:"etag"`
		Sector       int32  `json:"sector"`
		TICID        string `json:"tic_id"`
		ProductType  string `json:"product_type"`
		LastModified string `json:"last_modified"`
	} `json:"data"`
}

func (r *CatalogClickHouse) ListObjects(ctx context.Context, tier, prefix string, page, limit int) ([]repo.CatalogObject, int64, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	offset := (page - 1) * limit

	whereClause := fmt.Sprintf("tier = '%s'", tier)
	if prefix != "" && prefix != tier && prefix != tier+"/" {
		cleanPrefix := strings.ReplaceAll(prefix, "'", "\\'")
		whereClause += fmt.Sprintf(" AND object_key LIKE '%s%%'", cleanPrefix)
	}

	// 1. Get total and sum in 1ms
	countQuery := fmt.Sprintf("SELECT toString(count()) AS total, toString(sum(size_bytes)) AS total_bytes FROM aurora.lakehouse_objects WHERE %s FORMAT JSON", whereClause)
	countData, err := r.client.Query(ctx, countQuery)
	if err != nil {
		return nil, 0, 0, err
	}

	var countResp countResponse
	_ = json.Unmarshal(countData, &countResp)
	var total, totalBytes int64
	if len(countResp.Data) > 0 {
		total, _ = strconv.ParseInt(countResp.Data[0].Total, 10, 64)
		totalBytes, _ = strconv.ParseInt(countResp.Data[0].TotalBytes, 10, 64)
	}

	if total == 0 {
		return []repo.CatalogObject{}, 0, 0, nil
	}

	// 2. Fetch paginated objects in 1ms
	dataQuery := fmt.Sprintf("SELECT tier, object_key, toString(size_bytes) AS size_bytes, etag, sector, toString(tic_id) AS tic_id, product_type, toString(last_modified) AS last_modified FROM aurora.lakehouse_objects WHERE %s ORDER BY last_modified DESC LIMIT %d OFFSET %d FORMAT JSON", whereClause, limit, offset)
	dataBytes, err := r.client.Query(ctx, dataQuery)
	if err != nil {
		return nil, 0, 0, err
	}

	var listResp listResponse
	if err := json.Unmarshal(dataBytes, &listResp); err != nil {
		return nil, 0, 0, err
	}

	results := make([]repo.CatalogObject, len(listResp.Data))
	for i, row := range listResp.Data {
		sb, _ := strconv.ParseInt(row.SizeBytes, 10, 64)
		tic, _ := strconv.ParseInt(row.TICID, 10, 64)
		modTime, _ := time.Parse("2006-01-02 15:04:05", row.LastModified)
		results[i] = repo.CatalogObject{
			Tier:         row.Tier,
			ObjectKey:    row.ObjectKey,
			SizeBytes:    sb,
			ETag:         row.ETag,
			Sector:       row.Sector,
			TICID:        tic,
			ProductType:  row.ProductType,
			LastModified: modTime,
		}
	}

	return results, total, totalBytes, nil
}
