package repository

import (
	"context"
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

	batch, err := r.client.PrepareBatch(ctx, "INSERT INTO aurora.lakehouse_objects (tier, object_key, size_bytes, etag, sector, tic_id, product_type, last_modified)")
	if err != nil {
		return fmt.Errorf("prepare catalog objects batch: %w", err)
	}

	for _, obj := range objects {
		cleanEtag := strings.Trim(obj.ETag, "\"")
		if err := batch.Append(
			obj.Tier,
			obj.ObjectKey,
			obj.SizeBytes,
			cleanEtag,
			obj.Sector,
			obj.TICID,
			obj.ProductType,
			obj.LastModified.UTC(),
		); err != nil {
			return fmt.Errorf("append to catalog objects batch: %w", err)
		}
	}

	if err := batch.Send(); err != nil {
		return fmt.Errorf("send catalog objects batch: %w", err)
	}
	return nil
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

	// A path that does not identify a sector is inventory metadata, not Sector
	// 42.  Zero is explicitly the unknown/unscoped value across the API.
	var sector int32
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

func (r *CatalogClickHouse) CountObjects(ctx context.Context, tier string) (int64, int64, error) {
	if !validTier(tier) {
		return 0, 0, fmt.Errorf("unsupported lakehouse tier %q", tier)
	}
	var total, totalBytes int64
	row := r.client.QueryRow(ctx, "SELECT toInt64(count()), toInt64(coalesce(sum(size_bytes), 0)) FROM aurora.lakehouse_objects FINAL WHERE tier = ?", tier)
	if err := row.Scan(&total, &totalBytes); err != nil {
		return 0, 0, err
	}
	return total, totalBytes, nil
}

type catalogObjectRow struct {
	Tier         string    `ch:"tier"`
	ObjectKey    string    `ch:"object_key"`
	SizeBytes    int64     `ch:"size_bytes"`
	ETag         string    `ch:"etag"`
	Sector       int32     `ch:"sector"`
	TICID        int64     `ch:"tic_id"`
	ProductType  string    `ch:"product_type"`
	LastModified time.Time `ch:"last_modified"`
}

func (r *CatalogClickHouse) ListObjects(ctx context.Context, tier, prefix string, page, limit int) ([]repo.CatalogObject, int64, int64, error) {
	if !validTier(tier) {
		return nil, 0, 0, fmt.Errorf("unsupported lakehouse tier %q", tier)
	}
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	offset := (page - 1) * limit

	whereClause := "tier = ?"
	args := []any{tier}
	if prefix != "" && prefix != tier && prefix != tier+"/" {
		whereClause += " AND object_key LIKE ?"
		args = append(args, prefix+"%")
	}

	// 1. Get total and sum
	countQuery := fmt.Sprintf("SELECT toInt64(count()), toInt64(coalesce(sum(size_bytes), 0)) FROM aurora.lakehouse_objects FINAL WHERE %s", whereClause)
	var total, totalBytes int64
	if err := r.client.QueryRow(ctx, countQuery, args...).Scan(&total, &totalBytes); err != nil {
		return nil, 0, 0, err
	}

	if total == 0 {
		return []repo.CatalogObject{}, 0, 0, nil
	}

	// 2. Fetch paginated objects
	dataQuery := fmt.Sprintf("SELECT tier, object_key, size_bytes, etag, sector, tic_id, product_type, last_modified FROM aurora.lakehouse_objects FINAL WHERE %s ORDER BY last_modified DESC LIMIT ? OFFSET ?", whereClause)
	fetchArgs := append(append([]any(nil), args...), limit, offset)

	var rows []catalogObjectRow
	if err := r.client.Select(ctx, &rows, dataQuery, fetchArgs...); err != nil {
		return nil, 0, 0, fmt.Errorf("select catalog objects: %w", err)
	}

	results := make([]repo.CatalogObject, len(rows))
	for i, row := range rows {
		results[i] = repo.CatalogObject{
			Tier:         row.Tier,
			ObjectKey:    row.ObjectKey,
			SizeBytes:    row.SizeBytes,
			ETag:         row.ETag,
			Sector:       row.Sector,
			TICID:        row.TICID,
			ProductType:  row.ProductType,
			LastModified: row.LastModified,
		}
	}

	return results, total, totalBytes, nil
}

func validTier(tier string) bool {
	switch tier {
	case "bronze", "silver", "gold":
		return true
	default:
		return false
	}
}
