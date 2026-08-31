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
	"time"

	"go-ingester/internal/model"
)

// DiscoverOptions holds query parameters for one target-product discovery wave.
type DiscoverOptions struct {
	Sector   int
	Limit    int
	PageSize int
}

// DiscoverTESS discovers only complete target products. Full-frame images are
// deliberately outside this pipeline: every accepted sample is one TPF + LC pair.
func DiscoverTESS(ctx context.Context, client *Client, opts DiscoverOptions, log *slog.Logger) ([]model.Product, error) {
	if opts.PageSize <= 0 {
		opts.PageSize = 100
	}
	parents, err := queryTargetObservations(ctx, client, opts, log)
	if err != nil {
		return nil, fmt.Errorf("discover TESS target observations: %w", err)
	}
	observations, err := queryTargetProducts(ctx, client, parents, log)
	if err != nil {
		return nil, fmt.Errorf("discover TESS target products: %w", err)
	}

	products := make([]model.Product, 0, len(observations))
	for _, observation := range observations {
		dataURI := observationDataURI(observation)
		filename := observation.ProductFilename
		if filename == "" && dataURI != "" {
			filename = path.Base(dataURI)
			if colon := strings.LastIndex(filename, ":"); colon >= 0 {
				filename = filename[colon+1:]
			}
		}
		kind := classifyFilenameProduct(filename)
		if kind == model.KindUnknown {
			kind = ClassifyProduct(observation)
		}
		if kind == model.KindUnknown {
			kind = classifyCAOMProduct(observation)
		}
		if kind != model.KindTargetPixel && kind != model.KindLightCurve {
			continue
		}
		sector := opts.Sector
		if sector <= 0 {
			sector = firstPositive(observation.SequenceNumber, parseSectorFromObsID(observation.ObsID))
		}
		products = append(products, model.Product{
			ObsID:           observationSourceID(observation, filename),
			TICID:           parseTICFromTarget(observation.TargetName),
			Sector:          sector,
			Kind:            kind,
			Filename:        filename,
			DataURI:         dataURI,
			SizeBytes:       observation.SizeBytes,
			ProductSubGroup: observation.ProductSubGroup,
			Camera:          observation.Camera,
			CCD:             observation.CCD,
		})
	}
	log.Info("mast: target-product discovery complete", slog.Int("products", len(products)))
	return products, nil
}

func observationDataURI(observation Observation) string {
	if strings.TrimSpace(observation.DataURI) != "" {
		return observation.DataURI
	}
	return observation.DataURL
}

func observationSourceID(observation Observation, filename string) string {
	if dataURI := strings.TrimSpace(observationDataURI(observation)); dataURI != "" {
		return dataURI
	}
	if strings.TrimSpace(observation.ObsID) != "" {
		return observation.ObsID
	}
	return filename
}

func classifyCAOMProduct(observation Observation) model.ProductKind {
	if kind := classifyFilenameProduct(observation.ProductFilename); kind != model.KindUnknown {
		return kind
	}
	name := strings.ToLower(observation.ProductFilename + " " + observationDataURI(observation))
	if strings.Contains(name, "_tp") || strings.Contains(name, "targetpixel") || strings.EqualFold(observation.DataProductType, "targetpixel") {
		return model.KindTargetPixel
	}
	if strings.Contains(name, "_lc") || strings.EqualFold(observation.DataProductType, "timeseries") {
		return model.KindLightCurve
	}
	return model.KindUnknown
}

func classifyFilenameProduct(filename string) model.ProductKind {
	filename = strings.ToLower(strings.TrimSpace(filename))
	filename = strings.TrimSuffix(filename, ".gz")
	filename = strings.TrimSuffix(filename, ".fits")
	filename = strings.TrimSuffix(filename, ".fit")
	switch {
	case strings.HasSuffix(filename, "_tp"), strings.HasSuffix(filename, "-tp"):
		return model.KindTargetPixel
	case strings.HasSuffix(filename, "_lc"), strings.HasSuffix(filename, "-lc"):
		return model.KindLightCurve
	default:
		return model.KindUnknown
	}
}

// queryTargetProducts expands a CAOM LC parent into its exact sibling TPF + LC.
func queryTargetProducts(ctx context.Context, client *Client, parents []Observation, log *slog.Logger) ([]Observation, error) {
	products := make([]Observation, 0, len(parents)*2)
	for _, parent := range parents {
		if pair, ok := deriveTargetProductPair(parent); ok {
			products = append(products, pair...)
			continue
		}
		if parent.CatalogID <= 0 {
			products = append(products, parent)
			continue
		}
		children, err := queryMASTProducts(ctx, client, parent.CatalogID)
		if err != nil {
			return nil, fmt.Errorf("load products for observation %d: %w", parent.CatalogID, err)
		}
		for _, child := range children {
			kind := classifyFilenameProduct(child.ProductFilename)
			if kind != model.KindTargetPixel && kind != model.KindLightCurve {
				continue
			}
			child.TargetName = parent.TargetName
			child.SequenceNumber = parent.SequenceNumber
			child.RA, child.Dec = parent.RA, parent.Dec
			products = append(products, child)
		}
	}
	log.Info("mast: resolved target pairs", slog.Int("parents", len(parents)), slog.Int("products", len(products)))
	return products, nil
}

func deriveTargetProductPair(parent Observation) ([]Observation, bool) {
	dataURI := observationDataURI(parent)
	filename := parent.ProductFilename
	if filename == "" && dataURI != "" {
		filename = path.Base(dataURI)
		if colon := strings.LastIndex(filename, ":"); colon >= 0 {
			filename = filename[colon+1:]
		}
	}
	lowerURI := strings.ToLower(dataURI)
	lcSuffix, tpSuffix := "", ""
	switch {
	case strings.HasSuffix(lowerURI, "_lc.fits"):
		lcSuffix, tpSuffix = "_lc.fits", "_tp.fits"
	case strings.HasSuffix(lowerURI, "-lc.fits"):
		lcSuffix, tpSuffix = "-lc.fits", "-tp.fits"
	}
	if classifyFilenameProduct(filename) != model.KindLightCurve || lcSuffix == "" {
		return nil, false
	}
	lc := parent
	lc.ProductFilename, lc.DataURI, lc.DataURL, lc.ProductSubGroup = filename, dataURI, "", "LC"
	targetPixel := parent
	targetPixel.ProductFilename = filename[:len(filename)-len(lcSuffix)] + tpSuffix
	targetPixel.DataURI = dataURI[:len(dataURI)-len(lcSuffix)] + tpSuffix
	targetPixel.DataURL, targetPixel.ProductSubGroup = "", "TP"
	// Exact TPF Content-Length is reserved by the capacity gate before storage.
	targetPixel.SizeBytes = 0
	return []Observation{targetPixel, lc}, true
}

func queryMASTProducts(ctx context.Context, client *Client, catalogID int64) ([]Observation, error) {
	request := map[string]any{
		"service": "Mast.Caom.Products", "format": "json", "pagesize": 100, "page": 1,
		"params": map[string]any{"obsid": strconv.FormatInt(catalogID, 10)},
	}
	body, err := queryJSON(ctx, client, request)
	if err != nil {
		return nil, err
	}
	var response struct {
		Data []Observation `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode product response: %w", err)
	}
	return response.Data, nil
}

func queryTargetObservations(ctx context.Context, client *Client, opts DiscoverOptions, log *slog.Logger) ([]Observation, error) {
	startedAt := time.Now()
	filters := []map[string]any{
		{"paramName": "obs_collection", "values": []string{"TESS"}},
		{"paramName": "dataproduct_type", "values": []string{"timeseries"}},
	}
	if opts.Sector > 0 {
		filters = append(filters, map[string]any{"paramName": "sequence_number", "values": []string{strconv.Itoa(opts.Sector)}})
	}
	pageSize := opts.PageSize
	if opts.Limit <= 0 && pageSize < 25_000 {
		pageSize = 25_000
	}
	if opts.Limit > 0 && opts.Limit < pageSize {
		pageSize = opts.Limit
	}
	first, rowsTotal, err := queryTargetObservationPage(ctx, client, filters, pageSize, 1)
	if err != nil {
		return nil, err
	}
	if opts.Limit > 0 && len(first) >= opts.Limit {
		return first[:opts.Limit], nil
	}
	if len(first) == 0 || len(first) >= rowsTotal || len(first) < pageSize {
		return first, nil
	}
	totalPages := (rowsTotal + pageSize - 1) / pageSize
	observations := first
	for pageNumber := 2; pageNumber <= totalPages; pageNumber++ {
		pageRows, _, pageErr := queryTargetObservationPage(ctx, client, filters, pageSize, pageNumber)
		if pageErr != nil {
			return nil, pageErr
		}
		observations = append(observations, pageRows...)
	}
	log.Info("mast: target catalog loaded", slog.Int("rows", len(observations)), slog.Duration("elapsed", time.Since(startedAt)))
	return observations, nil
}

func queryTargetObservationPage(ctx context.Context, client *Client, filters []map[string]any, pageSize, pageNumber int) ([]Observation, int, error) {
	request := map[string]any{
		"service": "Mast.Caom.Filtered", "format": "json", "pagesize": pageSize, "page": pageNumber, "timeout": 30,
		"params": map[string]any{"columns": "*", "filters": filters},
	}
	body, err := queryJSON(ctx, client, request)
	if err != nil {
		return nil, 0, fmt.Errorf("query target page %d: %w", pageNumber, err)
	}
	var response struct {
		Data   []Observation `json:"data"`
		Paging struct {
			RowsTotal int `json:"rowsTotal"`
		} `json:"paging"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, 0, fmt.Errorf("decode target page %d: %w", pageNumber, err)
	}
	return response.Data, response.Paging.RowsTotal, nil
}

func queryJSON(ctx context.Context, client *Client, request map[string]any) ([]byte, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	values := url.Values{}
	values.Set("request", string(payload))
	return client.Query(ctx, values)
}

func parseTICFromTarget(target string) int64 {
	target = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(target), "TIC "), "TIC"))
	id, _ := strconv.ParseInt(target, 10, 64)
	return id
}

func parseSectorFromObsID(obsID string) int {
	index := strings.Index(obsID, "-s")
	if index < 0 || index+6 > len(obsID) {
		return 0
	}
	sector, _ := strconv.Atoi(obsID[index+2 : index+6])
	return sector
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}
