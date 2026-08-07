package mast

import (
	"context"
	"fmt"
	"log/slog"
)

// DiscoveryResult pairs one TESS observation with its filtered products.
type DiscoveryResult struct {
	Observation Observation
	Products    []Product
}

// DiscoverOptions controls discovery behaviour.
type DiscoverOptions struct {
	Sector   int // 0 = all sectors
	Limit    int // 0 = no limit on observations
	PageSize int // rows per MAST page
}

// DiscoverTESS queries Mast.Caom.Filtered for TESS observations, then fetches
// products for each via Mast.Caom.Products, returning only classified products.
func DiscoverTESS(ctx context.Context, c *Client, opts DiscoverOptions, log *slog.Logger) ([]DiscoveryResult, error) {
	observations, err := fetchObservations(ctx, c, opts, log)
	if err != nil {
		return nil, err
	}

	results := make([]DiscoveryResult, 0, len(observations))
	for _, obs := range observations {
		products, err := fetchProducts(ctx, c, obs.ObsID, log)
		if err != nil {
			// Log and continue — a single observation failure must not abort the run.
			log.Warn("mast: product fetch failed, skipping observation",
				slog.String("obs_id", obs.ObsID),
				slog.Any("error", err),
			)
			continue
		}

		var classified []Product
		for _, p := range products {
			if p.Kind != KindUnknown {
				classified = append(classified, p)
			}
		}

		results = append(results, DiscoveryResult{
			Observation: obs,
			Products:    classified,
		})
	}

	log.Info("mast: discovery complete",
		slog.Int("observations", len(observations)),
		slog.Int("results_with_products", len(results)),
	)
	return results, nil
}

// fetchObservations pages through Mast.Caom.Filtered for TESS observations.
func fetchObservations(ctx context.Context, c *Client, opts DiscoverOptions, log *slog.Logger) ([]Observation, error) {
	filters := []map[string]any{
		{"paramName": "obs_collection", "values": []string{"TESS"}},
	}
	if opts.Sector > 0 {
		filters = append(filters, map[string]any{
			"paramName": "sequence_number",
			"values":    []string{fmt.Sprintf("%d", opts.Sector)},
		})
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = 1000
	}

	var all []Observation
	for page := 1; ; page++ {
		req := mastRequest{
			Service: "Mast.Caom.Filtered",
			Params:  map[string]any{"filters": filters},
			Format:  "json",
			Page:    page,
			PageSize: pageSize,
		}

		resp, err := invoke[rawObservation](ctx, c, req)
		if err != nil {
			return nil, fmt.Errorf("mast observations page %d: %w", page, err)
		}

		log.Debug("mast: fetched observation page",
			slog.Int("page", page),
			slog.Int("count", len(resp.Data)),
		)

		for _, r := range resp.Data {
			all = append(all, r.toObservation())
			if opts.Limit > 0 && len(all) >= opts.Limit {
				return all, nil
			}
		}

		// Stop when we have all pages.
		if resp.Paging == nil || page >= resp.Paging.PagesFiltered || len(resp.Data) == 0 {
			break
		}
	}
	return all, nil
}

// fetchProducts queries Mast.Caom.Products for a single observation ID.
func fetchProducts(ctx context.Context, c *Client, obsID string, log *slog.Logger) ([]Product, error) {
	req := mastRequest{
		Service: "Mast.Caom.Products",
		Params:  map[string]any{"obsid": obsID},
		Format:  "json",
	}

	resp, err := invoke[rawProduct](ctx, c, req)
	if err != nil {
		return nil, fmt.Errorf("mast products obsid=%s: %w", obsID, err)
	}

	products := make([]Product, 0, len(resp.Data))
	for _, r := range resp.Data {
		products = append(products, r.toProduct())
	}

	log.Debug("mast: fetched products",
		slog.String("obs_id", obsID),
		slog.Int("count", len(products)),
	)
	return products, nil
}
