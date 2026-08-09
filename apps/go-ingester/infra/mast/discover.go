package mast

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"path"
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
	if opts.Limit > 0 && len(rawObs) > opts.Limit {
		// Keep the client-side guard even when MAST honors pagesize. It prevents
		// a server-side pagination change from turning a bounded plan into an
		// unexpectedly large download.
		rawObs = rawObs[:opts.Limit]
	}

	products := make([]model.Product, 0, len(rawObs))
	for _, obs := range rawObs {
		kind := ClassifyProduct(obs)
		if kind == model.KindUnknown {
			kind = classifyCAOMProduct(obs)
		}
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

		filename := obs.ProductFilename
		if filename == "" && obs.DataURL != "" {
			filename = path.Base(obs.DataURL)
			if colon := strings.LastIndex(filename, ":"); colon >= 0 {
				filename = filename[colon+1:]
			}
		}

		products = append(products, model.Product{
			ObsID:           obs.ObsID,
			TICID:           ticID,
			Sector:          sector,
			Kind:            kind,
			Filename:        filename,
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

// classifyCAOMProduct maps the compact fields returned by Mast.Caom.Filtered.
// That service returns dataproduct_type/dataURL rather than the richer product
// subgroup fields returned by Mast.Caom.Products.
func classifyCAOMProduct(obs model.Observation) model.ProductKind {
	name := strings.ToLower(obs.ProductFilename + " " + obs.DataURL)
	if strings.Contains(name, "_lc") || strings.EqualFold(obs.DataProductType, "timeseries") {
		return model.KindLightCurve
	}
	if strings.Contains(name, "_ffic") || strings.Contains(name, "_ffi") {
		return model.KindFFI
	}
	if strings.Contains(name, "_tp") || strings.Contains(name, "targetpixel") || strings.EqualFold(obs.DataProductType, "targetpixel") {
		return model.KindTargetPixel
	}
	return model.KindUnknown
}

func queryMASTObservations(ctx context.Context, client *Client, opts DiscoverOptions, log *slog.Logger) ([]model.Observation, error) {
	log.Debug("mast: querying MAST observations API", slog.Int("sector", opts.Sector))

	filters := []map[string]any{
		{"paramName": "obs_collection", "values": []string{"TESS"}},
		{"paramName": "dataproduct_type", "values": []string{"timeseries", "image"}},
	}
	if opts.Sector > 0 {
		filters = append(filters, map[string]any{
			"paramName": "sequence_number",
			"values":    []string{fmt.Sprintf("%d", opts.Sector)},
		})
	}

	observations := make([]model.Observation, 0)
	for page := 1; ; page++ {
		requestMap := map[string]any{
			// Mast.Caom.Filtered is the supported service for portal-style
			// observation filters. Mashup.Table.Query can return an empty dataset
			// for the same payload without reporting an error.
			"service":  "Mast.Caom.Filtered",
			"format":   "json",
			"pagesize": opts.PageSize,
			"page":     page,
			"timeout":  10,
			"params": map[string]any{
				"columns": "*",
				"filters": filters,
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
			Data   []model.Observation `json:"data"`
			Paging struct {
				RowsTotal int `json:"rowsTotal"`
			} `json:"paging"`
		}
		if err := json.Unmarshal(data, &rawResp); err != nil {
			return nil, fmt.Errorf("unmarshal observations response: %w", err)
		}

		observations = append(observations, rawResp.Data...)
		if opts.Limit > 0 && len(observations) >= opts.Limit {
			return observations[:opts.Limit], nil
		}
		if len(rawResp.Data) == 0 || rawResp.Paging.RowsTotal == 0 || len(observations) >= rawResp.Paging.RowsTotal || len(rawResp.Data) < opts.PageSize {
			return observations, nil
		}
	}
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
