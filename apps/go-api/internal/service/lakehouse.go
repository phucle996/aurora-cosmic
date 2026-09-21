package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"go-api/internal/domain/entity"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"

	"github.com/parquet-go/parquet-go"
)

const (
	maxLakehousePreviewFileSize = 150 * 1024 * 1024 // 150 MB
	maxLakehouseTextBytes       = 1 * 1024 * 1024   // 1 MB
)

// LakehouseService implements domainService.Lakehouse for Medallion cataloging and artifact inspection.
type LakehouseService struct {
	objects provider.ObjectStorage
	bucket  string
}

// NewLakehouseService constructs a LakehouseService instance.
func NewLakehouseService(objects provider.ObjectStorage, bucket string) domainService.Lakehouse {
	return &LakehouseService{
		objects: objects,
		bucket:  bucket,
	}
}

type prefixStatter interface {
	StatPrefix(ctx context.Context, prefix string) (int, int64, error)
}

func (s *LakehouseService) statTier(ctx context.Context, tier string) (int, int64, error) {
	if statter, ok := s.objects.(prefixStatter); ok {
		return statter.StatPrefix(ctx, tier)
	}
	objs, err := s.objects.ListObjects(ctx, tier)
	if err != nil {
		return 0, 0, err
	}
	var totalBytes int64
	for _, o := range objs {
		totalBytes += o.Size
	}
	return len(objs), totalBytes, nil
}

// Summary aggregates total object count and byte footprint across all Medallion tiers.
func (s *LakehouseService) Summary(ctx context.Context) (*entity.LakehouseSummary, error) {
	tiers := []string{"bronze/", "silver/", "gold/"}
	type tierResult struct {
		tier  string
		total int
		bytes int64
		err   error
	}

	results := make(chan tierResult, len(tiers))
	for _, t := range tiers {
		tier := t
		go func() {
			total, bytes, err := s.statTier(ctx, tier)
			results <- tierResult{tier: tier, total: total, bytes: bytes, err: err}
		}()
	}

	summary := &entity.LakehouseSummary{}
	for i := 0; i < len(tiers); i++ {
		res := <-results
		if res.err != nil {
			return nil, fmt.Errorf("stat lakehouse tier %q: %w", res.tier, res.err)
		}
		switch res.tier {
		case "bronze/":
			summary.Bronze = entity.LakehouseTierSummary{Total: res.total, TotalBytes: res.bytes}
		case "silver/":
			summary.Silver = entity.LakehouseTierSummary{Total: res.total, TotalBytes: res.bytes}
		case "gold/":
			summary.Gold = entity.LakehouseTierSummary{Total: res.total, TotalBytes: res.bytes}
		}
	}
	return summary, nil
}

// List enumerates Lakehouse objects using ListObjects, supporting search filtering and random-access page pagination.
func (s *LakehouseService) List(ctx context.Context, query entity.LakehouseListingQuery) (*entity.LakehouseListing, error) {
	rawObjects, err := s.objects.ListObjects(ctx, query.Prefix)
	if err != nil {
		return nil, fmt.Errorf("list lakehouse objects for prefix %q: %w", query.Prefix, err)
	}

	search := strings.ToLower(query.Search)
	var filtered []entity.LakehouseObject
	var totalBytes int64
	for _, obj := range rawObjects {
		if search != "" && !strings.Contains(strings.ToLower(obj.Key), search) {
			continue
		}
		totalBytes += obj.Size
		filtered = append(filtered, entity.LakehouseObject{
			Key:          obj.Key,
			SizeBytes:    obj.Size,
			ETag:         obj.ETag,
			LastModified: obj.LastModified,
			Tier:         detectLakehouseTier(obj.Key),
			Format:       detectLakehouseFormat(obj.Key),
		})
	}

	total := len(filtered)
	totalPages := 1
	if total > 0 {
		totalPages = (total + query.Limit - 1) / query.Limit
	}

	var pagedObjects []entity.LakehouseObject
	if total > 0 {
		start := (query.Page - 1) * query.Limit
		if start < total {
			end := start + query.Limit
			if end > total {
				end = total
			}
			pagedObjects = filtered[start:end]
		} else {
			pagedObjects = []entity.LakehouseObject{}
		}
	} else {
		pagedObjects = []entity.LakehouseObject{}
	}

	return &entity.LakehouseListing{
		Bucket:     s.bucket,
		Prefix:     query.Prefix,
		Page:       query.Page,
		Limit:      query.Limit,
		Total:      total,
		TotalPages: totalPages,
		TotalBytes: totalBytes,
		Objects:    pagedObjects,
	}, nil
}

// Preview reads and parses an object to return an interactive schema, header, or tabular preview.
func (s *LakehouseService) Preview(ctx context.Context, query entity.LakehousePreviewQuery) (*entity.LakehousePreviewResponse, error) {
	data, err := s.objects.GetObject(ctx, query.Key)
	if err != nil {
		return nil, fmt.Errorf("read lakehouse object %q: %w", query.Key, err)
	}

	sizeBytes := int64(len(data))
	sum := sha256.Sum256(data)
	contentSHA256 := fmt.Sprintf("%x", sum)
	tier := detectLakehouseTier(query.Key)
	format := detectLakehouseFormat(query.Key)

	resp := &entity.LakehousePreviewResponse{
		Key:           query.Key,
		Tier:          tier,
		Format:        format,
		SizeBytes:     sizeBytes,
		ContentSHA256: contentSHA256,
		LastModified:  time.Now().UTC().Format(time.RFC3339),
	}

	// 1. Parquet
	if format == "parquet" {
		if sizeBytes > maxLakehousePreviewFileSize {
			resp.Error = fmt.Sprintf("Parquet file is too large for preview (%d bytes > %d max)", sizeBytes, maxLakehousePreviewFileSize)
			return resp, nil
		}
		pqPreview, pErr := previewLakehouseParquet(data, query.Offset, query.Limit, query.Search)
		if pErr != nil {
			resp.Error = pErr.Error()
			return resp, nil
		}
		resp.Parquet = pqPreview
		return resp, nil
	}

	// 2. FITS
	if format == "fits" {
		fitsPreview, fErr := previewLakehouseFITS(data)
		if fErr != nil {
			resp.Error = fErr.Error()
			return resp, nil
		}
		resp.FITS = fitsPreview
		return resp, nil
	}

	// 3. JSON
	if format == "json" {
		var parsed any
		if jErr := json.Unmarshal(data, &parsed); jErr != nil {
			resp.Format = "text"
			resp.TextContent = string(data)
		} else {
			resp.JSONContent = parsed
		}
		return resp, nil
	}

	// 4. Text
	if format == "text" || (utf8.Valid(data) && len(data) <= maxLakehouseTextBytes) {
		resp.Format = "text"
		if len(data) > maxLakehouseTextBytes {
			resp.TextContent = string(data[:maxLakehouseTextBytes]) + "\n... [truncated]"
		} else {
			resp.TextContent = string(data)
		}
		return resp, nil
	}

	resp.Format = "binary"
	return resp, nil
}

func detectLakehouseTier(key string) string {
	lower := strings.ToLower(key)
	if strings.HasPrefix(lower, "bronze/") {
		return "bronze"
	}
	if strings.HasPrefix(lower, "silver/") {
		return "silver"
	}
	if strings.HasPrefix(lower, "gold/") {
		return "gold"
	}
	return "other"
}

func detectLakehouseFormat(key string) string {
	lower := strings.ToLower(key)
	if strings.HasSuffix(lower, ".parquet") || strings.HasSuffix(lower, ".pq") {
		return "parquet"
	}
	if strings.HasSuffix(lower, ".fits") || strings.HasSuffix(lower, ".fit") ||
		strings.HasSuffix(lower, ".fits.gz") || strings.HasSuffix(lower, ".fit.gz") {
		return "fits"
	}
	if strings.HasSuffix(lower, ".json") {
		return "json"
	}
	if strings.HasSuffix(lower, ".txt") || strings.HasSuffix(lower, ".csv") ||
		strings.HasSuffix(lower, ".tsv") || strings.HasSuffix(lower, ".log") ||
		strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".xml") ||
		strings.HasSuffix(lower, ".yaml") || strings.HasSuffix(lower, ".yml") {
		return "text"
	}
	return "binary"
}

func previewLakehouseParquet(data []byte, offset, limit int, search string) (*entity.LakehouseParquetPreview, error) {
	file, err := parquet.OpenFile(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open parquet file: %w", err)
	}

	schema := file.Schema()
	columns := make([]entity.LakehouseParquetColumn, 0, len(schema.Columns()))
	for _, path := range schema.Columns() {
		leaf, ok := schema.Lookup(path...)
		if !ok {
			continue
		}
		columns = append(columns, entity.LakehouseParquetColumn{
			Name:     path[len(path)-1],
			Path:     strings.Join(path, "."),
			Type:     leaf.Node.Type().String(),
			Nullable: leaf.Node.Optional(),
			Repeated: leaf.Node.Repeated(),
		})
	}

	reader := parquet.NewReader(bytes.NewReader(data))
	defer reader.Close()

	colPaths := schema.Columns()
	previewRows := make([]map[string]any, 0, limit)
	matchedRows := 0
	buf := make([]parquet.Row, 256)
	searchTerm := strings.ToLower(strings.TrimSpace(search))

	for {
		n, rErr := reader.ReadRows(buf)
		if rErr != nil && !errors.Is(rErr, io.EOF) {
			return nil, fmt.Errorf("read parquet rows: %w", rErr)
		}
		for _, row := range buf[:n] {
			record := make(map[string]any)
			matchesSearch := searchTerm == ""

			row.Range(func(colIdx int, vals []parquet.Value) bool {
				if colIdx < 0 || colIdx >= len(colPaths) {
					return true
				}
				colName := strings.Join(colPaths[colIdx], ".")
				var val any
				if len(vals) == 1 {
					val = formatParquetVal(vals[0])
				} else if len(vals) > 1 {
					items := make([]any, len(vals))
					for i, v := range vals {
						items[i] = formatParquetVal(v)
					}
					val = items
				}
				record[colName] = val

				if !matchesSearch && val != nil {
					strVal := fmt.Sprintf("%v", val)
					if strings.Contains(strings.ToLower(strVal), searchTerm) {
						matchesSearch = true
					}
				}
				return true
			})

			if !matchesSearch {
				continue
			}

			if matchedRows >= offset && len(previewRows) < limit {
				previewRows = append(previewRows, record)
			}
			matchedRows++
		}
		if errors.Is(rErr, io.EOF) {
			break
		}
	}

	return &entity.LakehouseParquetPreview{
		Columns:     columns,
		Rows:        previewRows,
		TotalRows:   file.NumRows(),
		MatchedRows: matchedRows,
		Offset:      offset,
		Limit:       limit,
	}, nil
}

func formatParquetVal(v parquet.Value) any {
	if v.IsNull() {
		return nil
	}
	switch v.Kind() {
	case parquet.Boolean:
		return v.Boolean()
	case parquet.Int32:
		return v.Int32()
	case parquet.Int64:
		return v.Int64()
	case parquet.Int96:
		return v.String()
	case parquet.Float:
		return v.Float()
	case parquet.Double:
		return v.Double()
	case parquet.ByteArray, parquet.FixedLenByteArray:
		b := v.ByteArray()
		if utf8.Valid(b) {
			return string(b)
		}
		return fmt.Sprintf("0x%x", b)
	default:
		return v.String()
	}
}

func previewLakehouseFITS(data []byte) (*entity.LakehouseFITSPreview, error) {
	if len(data) < 2880 {
		return nil, fmt.Errorf("file too small for FITS format (%d bytes)", len(data))
	}

	var hdus []entity.LakehouseFITSHDU
	pos := 0
	hduIndex := 0

	for pos+2880 <= len(data) && hduIndex < 10 {
		var cards []entity.LakehouseFITSHeaderCard
		summary := make(map[string]string)
		reachedEnd := false

		for pos+2880 <= len(data) {
			block := data[pos : pos+2880]
			pos += 2880

			for i := 0; i < 2880; i += 80 {
				cardRaw := string(block[i : i+80])
				keyword := strings.TrimSpace(cardRaw[:8])
				if keyword == "END" {
					reachedEnd = true
					break
				}
				if keyword == "" || keyword == "COMMENT" || keyword == "HISTORY" {
					if keyword != "" {
						cards = append(cards, entity.LakehouseFITSHeaderCard{
							Keyword: keyword,
							Value:   "",
							Comment: strings.TrimSpace(cardRaw[8:]),
						})
					}
					continue
				}

				val := ""
				comment := ""
				if len(cardRaw) > 10 && cardRaw[8:10] == "= " {
					rest := cardRaw[10:]
					slashIdx := strings.Index(rest, "/")
					if slashIdx != -1 {
						val = strings.TrimSpace(rest[:slashIdx])
						comment = strings.TrimSpace(rest[slashIdx+1:])
					} else {
						val = strings.TrimSpace(rest)
					}
					if strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'") && len(val) >= 2 {
						val = strings.TrimSpace(val[1 : len(val)-1])
					}
				}

				cards = append(cards, entity.LakehouseFITSHeaderCard{
					Keyword: keyword,
					Value:   val,
					Comment: comment,
				})

				switch keyword {
				case "OBJECT", "TICID", "SECTOR", "CAMERA", "CCD", "EXPOSURE", "DATE-OBS", "DATE-END",
					"TELESCOP", "INSTRUME", "TSTART", "TSTOP", "NAXIS1", "NAXIS2", "TFIELDS", "EXTNAME",
					"RADESYS", "RA_OBJ", "DEC_OBJ", "TESSMAG":
					if val != "" {
						summary[keyword] = val
					}
				}
			}

			if reachedEnd {
				break
			}
		}

		if len(cards) == 0 {
			break
		}

		cardMap := make(map[string]string, len(cards))
		for _, c := range cards {
			if c.Keyword != "" {
				cardMap[c.Keyword] = c.Value
			}
		}

		hduName := summary["EXTNAME"]
		hduType := "PRIMARY"
		if hduIndex > 0 {
			hduType = "EXTENSION"
			for _, c := range cards {
				if c.Keyword == "XTENSION" {
					hduType = c.Value
					break
				}
			}
		}
		if hduName == "" {
			hduName = fmt.Sprintf("HDU %d (%s)", hduIndex, hduType)
		}

		var tablePreview *entity.LakehouseFITSTablePreview
		dataSize := 0
		if hduType == "BINTABLE" {
			naxis1, _ := strconv.Atoi(cardMap["NAXIS1"])
			naxis2, _ := strconv.Atoi(cardMap["NAXIS2"])
			tfields, _ := strconv.Atoi(cardMap["TFIELDS"])
			if naxis1 > 0 && naxis2 > 0 {
				tablePreview = decodeFITSBinTable(data, pos, naxis1, naxis2, tfields, cardMap)
				dataSize = naxis1 * naxis2
			}
		} else if hduType == "IMAGE" {
			bitpix, _ := strconv.Atoi(cardMap["BITPIX"])
			naxis, _ := strconv.Atoi(cardMap["NAXIS"])
			if naxis >= 2 {
				n1, _ := strconv.Atoi(cardMap["NAXIS1"])
				n2, _ := strconv.Atoi(cardMap["NAXIS2"])
				bytesPerPix := int(math.Abs(float64(bitpix))) / 8
				if bytesPerPix < 1 {
					bytesPerPix = 1
				}
				dataSize = n1 * n2 * bytesPerPix
			}
		}

		hdus = append(hdus, entity.LakehouseFITSHDU{
			Index:   hduIndex,
			Name:    hduName,
			Type:    hduType,
			Cards:   cards,
			Summary: summary,
			Table:   tablePreview,
		})

		hduIndex++

		// Advance pos past data block (padded to 2880 bytes)
		if dataSize > 0 {
			paddedBlocks := ((dataSize + 2879) / 2880) * 2880
			pos += paddedBlocks
		}

		// Scan for next HDU block
		nextHduFound := false
		for pos+80 <= len(data) {
			if pos+2880 <= len(data) {
				probe := string(data[pos : pos+80])
				if strings.HasPrefix(probe, "XTENSION=") || strings.HasPrefix(probe, "SIMPLE  =") {
					nextHduFound = true
					break
				}
			}
			pos += 2880
		}
		if !nextHduFound {
			break
		}
	}

	return &entity.LakehouseFITSPreview{HDUs: hdus}, nil
}

type fitsColDef struct {
	name   string
	unit   string
	format string
	kind   byte
	size   int
	offset int
}

func decodeFITSBinTable(data []byte, startPos int, naxis1, naxis2, tfields int, cardMap map[string]string) *entity.LakehouseFITSTablePreview {
	if naxis1 <= 0 || naxis2 <= 0 || tfields <= 0 || startPos >= len(data) {
		return nil
	}
	cols := make([]fitsColDef, 0, tfields)
	entityCols := make([]entity.LakehouseFITSTableColumn, 0, tfields)
	offset := 0
	for i := 1; i <= tfields; i++ {
		name := cardMap[fmt.Sprintf("TTYPE%d", i)]
		form := cardMap[fmt.Sprintf("TFORM%d", i)]
		unit := cardMap[fmt.Sprintf("TUNIT%d", i)]
		if name == "" {
			name = fmt.Sprintf("COL_%d", i)
		}
		kind := byte('A')
		if len(form) > 0 {
			kind = form[len(form)-1]
		}
		size := 1
		colType := "string"
		switch kind {
		case 'D':
			size = 8
			colType = "float64"
		case 'E':
			size = 4
			colType = "float32"
		case 'J':
			size = 4
			colType = "int32"
		case 'I':
			size = 2
			colType = "int16"
		case 'B':
			size = 1
			colType = "uint8"
		case 'A':
			size = 1
			colType = "string"
		}

		cols = append(cols, fitsColDef{
			name:   name,
			unit:   unit,
			format: form,
			kind:   kind,
			size:   size,
			offset: offset,
		})
		entityCols = append(entityCols, entity.LakehouseFITSTableColumn{
			Name: name,
			Type: colType,
			Unit: unit,
		})
		offset += size
	}

	totalDataBytes := naxis1 * naxis2
	if startPos+totalDataBytes > len(data) {
		totalDataBytes = len(data) - startPos
	}
	actualRows := totalDataBytes / naxis1
	if actualRows <= 0 {
		return nil
	}

	maxSampleRows := 100
	if maxSampleRows > actualRows {
		maxSampleRows = actualRows
	}

	rows := make([]map[string]any, 0, maxSampleRows)
	for r := 0; r < maxSampleRows; r++ {
		rowOffset := startPos + r*naxis1
		if rowOffset+naxis1 > len(data) {
			break
		}
		rowBytes := data[rowOffset : rowOffset+naxis1]
		row := make(map[string]any, len(cols)+1)
		row["_row"] = r + 1
		for _, c := range cols {
			if c.offset+c.size > len(rowBytes) {
				continue
			}
			cb := rowBytes[c.offset : c.offset+c.size]
			switch c.kind {
			case 'D':
				val := math.Float64frombits(binary.BigEndian.Uint64(cb))
				if math.IsNaN(val) || math.IsInf(val, 0) {
					row[c.name] = nil
				} else {
					row[c.name] = val
				}
			case 'E':
				val := math.Float32frombits(binary.BigEndian.Uint32(cb))
				if math.IsNaN(float64(val)) || math.IsInf(float64(val), 0) {
					row[c.name] = nil
				} else {
					row[c.name] = val
				}
			case 'J':
				row[c.name] = int32(binary.BigEndian.Uint32(cb))
			case 'I':
				row[c.name] = int16(binary.BigEndian.Uint16(cb))
			case 'B':
				row[c.name] = uint8(cb[0])
			case 'A':
				row[c.name] = strings.TrimSpace(string(cb))
			default:
				row[c.name] = nil
			}
		}
		rows = append(rows, row)
	}

	// Downsample for fast, interactive time-series chart
	chartPoints := make([]map[string]any, 0, 300)
	step := actualRows / 300
	if step < 1 {
		step = 1
	}

	var timeCol, fluxCol, errCol *fitsColDef
	for i := range cols {
		switch cols[i].name {
		case "TIME":
			timeCol = &cols[i]
		case "PDCSAP_FLUX":
			fluxCol = &cols[i]
		case "PDCSAP_FLUX_ERR":
			errCol = &cols[i]
		case "SAP_FLUX":
			if fluxCol == nil {
				fluxCol = &cols[i]
			}
		case "SAP_FLUX_ERR":
			if errCol == nil {
				errCol = &cols[i]
			}
		}
	}

	if timeCol != nil && fluxCol != nil {
		for r := 0; r < actualRows; r += step {
			rowOffset := startPos + r*naxis1
			if rowOffset+naxis1 > len(data) {
				break
			}
			rowBytes := data[rowOffset : rowOffset+naxis1]

			var tVal float64
			var fVal float64
			hasTime := false
			hasFlux := false

			if timeCol.kind == 'D' && timeCol.offset+8 <= len(rowBytes) {
				tVal = math.Float64frombits(binary.BigEndian.Uint64(rowBytes[timeCol.offset : timeCol.offset+8]))
				if !math.IsNaN(tVal) && !math.IsInf(tVal, 0) {
					hasTime = true
				}
			}

			if fluxCol.kind == 'E' && fluxCol.offset+4 <= len(rowBytes) {
				v := math.Float32frombits(binary.BigEndian.Uint32(rowBytes[fluxCol.offset : fluxCol.offset+4]))
				if !math.IsNaN(float64(v)) && !math.IsInf(float64(v), 0) {
					fVal = float64(v)
					hasFlux = true
				}
			}

			if hasTime && hasFlux {
				pt := map[string]any{
					"time": tVal,
					"flux": fVal,
				}
				if errCol != nil && errCol.kind == 'E' && errCol.offset+4 <= len(rowBytes) {
					eV := math.Float32frombits(binary.BigEndian.Uint32(rowBytes[errCol.offset : errCol.offset+4]))
					if !math.IsNaN(float64(eV)) && !math.IsInf(float64(eV), 0) {
						pt["flux_err"] = float64(eV)
					}
				}
				chartPoints = append(chartPoints, pt)
			}
		}
	}

	return &entity.LakehouseFITSTablePreview{
		TotalRows: naxis2,
		Columns:   entityCols,
		Rows:      rows,
		Chart:     chartPoints,
	}
}
