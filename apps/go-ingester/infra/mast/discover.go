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
	"sync"
	"time"

	"go-ingester/internal/model"
)

// DiscoverOptions holds query parameters for one target-product discovery wave.
type DiscoverOptions struct {
	Sector   int
	Limit    int
	PageSize int
	Progress func(DiscoverProgress)
}

// DiscoverProgress reports measured work from MAST, never an estimated timer.
// Completed/Total describe the current stage and may reset when Stage changes.
type DiscoverProgress struct {
	Stage     string
	Completed int
	Total     int
	Products  int
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
	observations, err := queryTargetProducts(ctx, client, parents, log, opts.Progress)
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
func queryTargetProducts(ctx context.Context, client *Client, parents []Observation, log *slog.Logger, progress func(DiscoverProgress)) ([]Observation, error) {
	products := make([]Observation, 0, len(parents)*2)
	for index, parent := range parents {
		if pair, ok := deriveTargetProductPair(parent); ok {
			products = append(products, pair...)
		} else if parent.CatalogID <= 0 {
			products = append(products, parent)
		} else if !shouldExpandTargetProducts(parent) {
			// Multi-sector DV rows and other non-LC/TP timeseries products are
			// not acquisition samples. Expanding them one-by-one through
			// Mast.Caom.Products previously added thousands of remote calls.
		} else {
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
		completed := index + 1
		if progress != nil && (completed%1000 == 0 || completed == len(parents)) {
			progress(DiscoverProgress{Stage: "RESOLVING_MAST_PRODUCTS", Completed: completed, Total: len(parents), Products: len(products)})
		}
	}
	log.Info("mast: resolved target pairs", slog.Int("parents", len(parents)), slog.Int("products", len(products)))
	return products, nil
}

func shouldExpandTargetProducts(parent Observation) bool {
	if isMultiSectorObservation(parent.ObsID) {
		return false
	}
	// A non-empty URI that is not an LC/TP contract identifies another
	// timeseries family (for example DVT validation products), not a missing
	// target pair. Only rows without a URI require a Products lookup.
	return strings.TrimSpace(observationDataURI(parent)) == ""
}

func isMultiSectorObservation(obsID string) bool {
	sectorTokens := 0
	for _, token := range strings.Split(strings.ToLower(obsID), "-") {
		if len(token) != 5 || token[0] != 's' {
			continue
		}
		if _, err := strconv.Atoi(token[1:]); err == nil {
			sectorTokens++
		}
	}
	return sectorTokens > 1
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
	inputSuffix, lcSuffix, tpSuffix := "", "", ""
	switch {
	case strings.HasSuffix(lowerURI, "_lc.fits"):
		inputSuffix, lcSuffix, tpSuffix = "_lc.fits", "_lc.fits", "_tp.fits"
	case strings.HasSuffix(lowerURI, "-lc.fits"):
		inputSuffix, lcSuffix, tpSuffix = "-lc.fits", "-lc.fits", "-tp.fits"
	case strings.HasSuffix(lowerURI, "_tp.fits"):
		inputSuffix, lcSuffix, tpSuffix = "_tp.fits", "_lc.fits", "_tp.fits"
	case strings.HasSuffix(lowerURI, "-tp.fits"):
		inputSuffix, lcSuffix, tpSuffix = "-tp.fits", "-lc.fits", "-tp.fits"
	}
	if inputSuffix == "" {
		return nil, false
	}
	baseFilename := filename[:len(filename)-len(inputSuffix)]
	baseURI := dataURI[:len(dataURI)-len(inputSuffix)]
	lc := parent
	lc.ProductFilename, lc.DataURI, lc.DataURL, lc.ProductSubGroup = baseFilename+lcSuffix, baseURI+lcSuffix, "", "LC"
	targetPixel := parent
	targetPixel.ProductFilename = baseFilename + tpSuffix
	targetPixel.DataURI = baseURI + tpSuffix
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
	if opts.Limit > 0 && opts.Limit < pageSize {
		pageSize = opts.Limit
	}
	first, rowsTotal, err := queryTargetObservationPage(ctx, client, filters, pageSize, 1)
	if err != nil {
		return nil, err
	}
	totalTargets := rowsTotal
	if totalTargets < len(first) {
		totalTargets = len(first)
	}
	if opts.Progress != nil {
		opts.Progress(DiscoverProgress{Stage: "DISCOVERING_MAST_TARGETS", Completed: len(first), Total: totalTargets})
	}
	if opts.Limit > 0 && len(first) >= opts.Limit {
		return first[:opts.Limit], nil
	}
	if len(first) == 0 || len(first) >= rowsTotal || len(first) < pageSize {
		return first, nil
	}
	totalPages := (rowsTotal + pageSize - 1) / pageSize
	pageRows := make([][]Observation, totalPages+1)
	pageRows[1] = first
	type result struct {
		page int
		rows []Observation
		err  error
	}
	workerCtx, cancelWorkers := context.WithCancel(ctx)
	defer cancelWorkers()
	jobs := make(chan int)
	results := make(chan result)
	workerCount := min(4, totalPages-1)
	var workers sync.WaitGroup
	for range workerCount {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for pageNumber := range jobs {
				rows, _, pageErr := queryTargetObservationPage(workerCtx, client, filters, pageSize, pageNumber)
				results <- result{page: pageNumber, rows: rows, err: pageErr}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for pageNumber := 2; pageNumber <= totalPages; pageNumber++ {
			select {
			case <-workerCtx.Done():
				return
			case jobs <- pageNumber:
			}
		}
	}()
	go func() {
		workers.Wait()
		close(results)
	}()
	completedTargets := len(first)
	var firstErr error
	for pageResult := range results {
		if pageResult.err != nil {
			if firstErr == nil {
				firstErr = pageResult.err
				cancelWorkers()
			}
			continue
		}
		pageRows[pageResult.page] = pageResult.rows
		completedTargets += len(pageResult.rows)
		if opts.Progress != nil {
			opts.Progress(DiscoverProgress{Stage: "DISCOVERING_MAST_TARGETS", Completed: completedTargets, Total: totalTargets})
		}
	}
	if firstErr != nil {
		return nil, firstErr
	}
	observations := make([]Observation, 0, rowsTotal)
	for pageNumber := 1; pageNumber <= totalPages; pageNumber++ {
		observations = append(observations, pageRows[pageNumber]...)
	}
	log.Info("mast: target catalog loaded", slog.Int("rows", len(observations)), slog.Duration("elapsed", time.Since(startedAt)))
	return observations, nil
}

func queryTargetObservationPage(ctx context.Context, client *Client, filters []map[string]any, pageSize, pageNumber int) ([]Observation, int, error) {
	request := map[string]any{
		"service": "Mast.Caom.Filtered", "format": "json", "pagesize": pageSize, "page": pageNumber, "timeout": 30,
		"params": map[string]any{
			"columns": "obsid,obs_id,target_name,sequence_number,dataURL,s_ra,s_dec,dataproduct_type",
			"filters": filters,
		},
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
