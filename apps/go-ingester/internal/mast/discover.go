package mast

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"

	"go-ingester/internal/model"
)

// DiscoverOptions holds query parameters for MAST TESS product discovery.
type DiscoverOptions struct {
	Sector   int
	Limit    int
	PageSize int
}

// DiscoverTESS performs product discovery against MAST API for TESS observations.
func DiscoverTESS(ctx context.Context, client *Client, opts DiscoverOptions, log *slog.Logger) ([]model.Product, error) {
	if opts.PageSize <= 0 {
		opts.PageSize = 100
	}

	rawObs, err := queryMASTObservations(ctx, client, opts, log)
	if err != nil {
		return nil, fmt.Errorf("discover TESS: %w", err)
	}

	products := make([]model.Product, 0, len(rawObs))
	for _, obs := range rawObs {
		kind := ClassifyProduct(obs)
		if kind == model.KindUnknown {
			log.Debug("mast: skipping unknown product kind",
				slog.String("obs_id", obs.ObsID),
				slog.String("subgroup", obs.ProductSubGroup),
			)
			continue
		}

		ticID := parseTICFromTarget(obs.TargetName)
		sector := opts.Sector
		if sector <= 0 {
			sector = parseSectorFromObsID(obs.ObsID)
		}

		products = append(products, model.Product{
			ObsID:           obs.ObsID,
			TICID:           ticID,
			Sector:          sector,
			Kind:            kind,
			Filename:        obs.ProductFilename,
			DataURI:         obs.DataURL,
			SizeBytes:       obs.SizeBytes,
			ProductSubGroup: obs.ProductSubGroup,
		})
	}

	log.Info("mast: discovery complete",
		slog.Int("total_discovered", len(products)),
	)

	return products, nil
}

func queryMASTObservations(ctx context.Context, client *Client, opts DiscoverOptions, log *slog.Logger) ([]model.Observation, error) {
	requestMap := map[string]any{
		"service": "Mashup.Table.Query",
		"format":  "json",
		"params": map[string]any{
			"columns": "*",
			"filters": []map[string]any{
				{"paramName": "obs_collection", "values": []string{"TESS"}},
				{"paramName": "dataproduct_type", "values": []string{"timeseries", "image"}},
			},
		},
	}

	jsonBytes, err := json.Marshal(requestMap)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	values := url.Values{}
	values.Set("request", string(jsonBytes))

	data, err := client.Query(ctx, values)
	if err != nil {
		return nil, err
	}

	var rawResp struct {
		Data []model.Observation `json:"data"`
	}

	if err := json.Unmarshal(data, &rawResp); err != nil {
		return nil, fmt.Errorf("unmarshal observations response: %w", err)
	}

	return rawResp.Data, nil
}

func parseTICFromTarget(target string) int64 {
	target = strings.TrimSpace(target)
	target = strings.TrimPrefix(target, "TIC ")
	target = strings.TrimPrefix(target, "TIC")
	id, err := strconv.ParseInt(target, 10, 64)
	if err != nil {
		return 0
	}
	return id
}

func parseSectorFromObsID(obsID string) int {
	idx := strings.Index(obsID, "-s")
	if idx == -1 || idx+6 > len(obsID) {
		return 0
	}
	sectorStr := obsID[idx+2 : idx+6]
	sector, err := strconv.Atoi(sectorStr)
	if err != nil {
		return 0
	}
	return sector
}
