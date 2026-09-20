package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/provider"
)

var (
	ticRegex       = regexp.MustCompile(`/(?:tic|tid)=(\d+)`)
	sectorRegex    = regexp.MustCompile(`/sector=(\d+)`)
	processorRegex = regexp.MustCompile(`/processor=([^/]+)`)
)

type lineageService struct {
	repo    repo.LineageRepository
	objects provider.ObjectStorage
}

func NewLineageService(repo repo.LineageRepository, objects provider.ObjectStorage) domainService.LineageService {
	return &lineageService{
		repo:    repo,
		objects: objects,
	}
}

func (s *lineageService) TraceLineage(ctx context.Context, inputs []entity.LineageLookup) ([]entity.LineageResolution, error) {
	if s.repo == nil || len(inputs) == 0 {
		resolutions := make([]entity.LineageResolution, len(inputs))
		for index, input := range inputs {
			resolutions[index] = entity.LineageResolution{
				SourceProductID: strings.TrimSpace(input.SourceProductID),
				SilverObjectKey: strings.TrimSpace(input.SilverObjectKey),
				Status:          "PENDING",
			}
		}
		return resolutions, nil
	}
	return s.repo.TraceLineage(ctx, inputs)
}

func (s *lineageService) GetLedger(ctx context.Context, query entity.LineageLedgerQuery) (*entity.LineageLedgerResponse, error) {
	bronzePrefix := fmt.Sprintf("bronze/tess/%s/", query.ProductKind)
	silverPrefix := fmt.Sprintf("silver/tess/%s/", query.ProductKind)
	lineagePrefix := fmt.Sprintf("lineage/v1/tess/%s/", query.ProductKind)

	if s.objects == nil {
		return &entity.LineageLedgerResponse{
			Items:     []entity.LineageRecord{},
			Inventory: entity.LineageInventory{},
			Total:     0,
			Page:      query.Page,
			PageSize:  query.PageSize,
		}, nil
	}

	var (
		bronzeObjs  []provider.ObjectInfo
		silverObjs  []provider.ObjectInfo
		lineageObjs []provider.ObjectInfo
		errBronze   error
		errSilver   error
		errLineage  error
		wg          sync.WaitGroup
	)

	wg.Add(3)
	go func() {
		defer wg.Done()
		bronzeObjs, errBronze = s.objects.ListObjects(ctx, bronzePrefix)
	}()
	go func() {
		defer wg.Done()
		silverObjs, errSilver = s.objects.ListObjects(ctx, silverPrefix)
	}()
	go func() {
		defer wg.Done()
		lineageObjs, errLineage = s.objects.ListObjects(ctx, lineagePrefix)
	}()
	wg.Wait()

	if errBronze != nil {
		return nil, fmt.Errorf("list bronze objects for %s: %w", query.ProductKind, errBronze)
	}
	if errSilver != nil {
		return nil, fmt.Errorf("list silver objects for %s: %w", query.ProductKind, errSilver)
	}
	if errLineage != nil {
		return nil, fmt.Errorf("list lineage objects for %s: %w", query.ProductKind, errLineage)
	}

	type silverInfo struct {
		obj              provider.ObjectInfo
		sourceProductID  string
		baseName         string
		processorVersion string
	}

	silverBySource := make(map[string]silverInfo)
	silverByBase := make(map[string]silverInfo)

	for _, obj := range silverObjs {
		srcID, base, procVer := parseSilverKey(obj.Key)
		info := silverInfo{
			obj:              obj,
			sourceProductID:  srcID,
			baseName:         base,
			processorVersion: procVer,
		}
		if srcID != "" {
			if existing, ok := silverBySource[srcID]; !ok || obj.LastModified.After(existing.obj.LastModified) {
				silverBySource[srcID] = info
			}
		}
		if base != "" {
			if existing, ok := silverByBase[base]; !ok || obj.LastModified.After(existing.obj.LastModified) {
				silverByBase[base] = info
			}
		}
	}

	lineageByID := make(map[string]provider.ObjectInfo)
	for _, obj := range lineageObjs {
		id := parseLineageKey(obj.Key)
		if id != "" {
			lineageByID[id] = obj
		}
	}

	allRecords := make([]entity.LineageRecord, 0, len(bronzeObjs))
	traceLookups := make([]entity.LineageLookup, 0, len(bronzeObjs))

	for _, bronze := range bronzeObjs {
		sourceProductID, bronzeFilename, baseName, ticID, sector := parseBronzeKey(bronze.Key)

		rec := entity.LineageRecord{
			Identity:        fmt.Sprintf("%s:%s", query.ProductKind, sourceProductID),
			TICID:           ticID,
			Sector:          sector,
			ProductKind:     query.ProductKind,
			SourceProductID: sourceProductID,
			Bronze: entity.LineageStorageRef{
				Key:          bronze.Key,
				SizeBytes:    bronze.Size,
				ETag:         cleanETag(bronze.ETag),
				LastModified: bronze.LastModified.UTC().Format(time.RFC3339),
			},
		}

		var matchedSilver *silverInfo
		if info, ok := silverBySource[sourceProductID]; ok {
			matchedSilver = &info
		} else if info, ok := silverByBase[baseName]; ok {
			matchedSilver = &info
		}

		if matchedSilver != nil {
			rec.Silver = &entity.LineageStorageRef{
				Key:          matchedSilver.obj.Key,
				SizeBytes:    matchedSilver.obj.Size,
				ETag:         cleanETag(matchedSilver.obj.ETag),
				LastModified: matchedSilver.obj.LastModified.UTC().Format(time.RFC3339),
			}
			rec.ProcessorVersion = matchedSilver.processorVersion

			effectiveSourceID := sourceProductID
			if matchedSilver.sourceProductID != "" {
				effectiveSourceID = matchedSilver.sourceProductID
			}

			candidates := []string{
				deriveLineageID(effectiveSourceID, rec.ProcessorVersion),
				deriveLineageID(bronzeFilename, rec.ProcessorVersion),
				deriveLineageID(sourceProductID, rec.ProcessorVersion),
				deriveLineageID(baseName, rec.ProcessorVersion),
			}

			for _, candidate := range candidates {
				if candidate == "" {
					continue
				}
				if linObj, ok := lineageByID[candidate]; ok {
					rec.LineageID = candidate
					rec.Lineage = &entity.LineageStorageRef{
						Key:          linObj.Key,
						SizeBytes:    linObj.Size,
						ETag:         cleanETag(linObj.ETag),
						LastModified: linObj.LastModified.UTC().Format(time.RFC3339),
					}
					break
				}
			}
		}

		allRecords = append(allRecords, rec)

		silverKey := ""
		if rec.Silver != nil {
			silverKey = rec.Silver.Key
		}
		traceLookups = append(traceLookups, entity.LineageLookup{
			SourceProductID: rec.SourceProductID,
			SilverObjectKey: silverKey,
		})
	}

	if s.repo != nil && len(traceLookups) > 0 {
		resolutions, err := s.repo.TraceLineage(ctx, traceLookups)
		if err == nil && len(resolutions) == len(allRecords) {
			for i := range allRecords {
				res := resolutions[i]
				allRecords[i].Gold = &res
			}
		}
	}

	goldCount := 0
	for _, rec := range allRecords {
		if rec.Gold != nil && rec.Gold.Status == "EXTRACTED" {
			goldCount++
		}
	}

	inventory := entity.LineageInventory{
		Bronze:  len(bronzeObjs),
		Silver:  len(silverObjs),
		Lineage: len(lineageObjs),
		Gold:    goldCount,
	}

	sort.Slice(allRecords, func(i, j int) bool {
		s1, s2 := 0, 0
		if allRecords[i].Sector != nil {
			s1 = *allRecords[i].Sector
		}
		if allRecords[j].Sector != nil {
			s2 = *allRecords[j].Sector
		}
		if s1 != s2 {
			return s1 < s2
		}
		if allRecords[i].TICID != allRecords[j].TICID {
			return allRecords[i].TICID < allRecords[j].TICID
		}
		return allRecords[i].Bronze.Key < allRecords[j].Bronze.Key
	})

	searchLower := strings.ToLower(query.Search)

	filtered := make([]entity.LineageRecord, 0, len(allRecords))
	for _, rec := range allRecords {
		if query.StageFilter != "all" && query.StageFilter != "" && recordStage(rec) != query.StageFilter {
			continue
		}
		if searchLower != "" {
			silverKey := ""
			if rec.Silver != nil {
				silverKey = rec.Silver.Key
			}
			snapshotID := ""
			if rec.Gold != nil {
				snapshotID = rec.Gold.SnapshotID
			}
			match := strings.Contains(strings.ToLower(rec.TICID), searchLower) ||
				strings.Contains(strings.ToLower(rec.SourceProductID), searchLower) ||
				strings.Contains(strings.ToLower(rec.Bronze.Key), searchLower) ||
				strings.Contains(strings.ToLower(silverKey), searchLower) ||
				strings.Contains(strings.ToLower(rec.LineageID), searchLower) ||
				strings.Contains(strings.ToLower(snapshotID), searchLower)
			if !match {
				continue
			}
		}
		filtered = append(filtered, rec)
	}

	total := len(filtered)
	start := (query.Page - 1) * query.PageSize
	if start < 0 {
		start = 0
	}
	if start > total {
		start = total
	}
	end := start + query.PageSize
	if end < start || end > total {
		end = total
	}

	pageItems := filtered[start:end]

	return &entity.LineageLedgerResponse{
		Items:     pageItems,
		Inventory: inventory,
		Total:     total,
		Page:      query.Page,
		PageSize:  query.PageSize,
	}, nil
}

func recordStage(r entity.LineageRecord) string {
	if r.Gold != nil && r.Gold.Status == "EXTRACTED" {
		return "gold"
	}
	if r.Silver != nil {
		return "silver"
	}
	return "bronze"
}

func deriveLineageID(sourceProductID, processorVersion string) string {
	if sourceProductID == "" || processorVersion == "" {
		return ""
	}
	h := sha256.Sum256(fmt.Appendf(nil, "%s:%s", sourceProductID, processorVersion))
	return hex.EncodeToString(h[:])
}

func parseBronzeKey(key string) (sourceProductID string, bronzeFilename string, baseName string, ticID string, sector *int) {
	bronzeFilename = path.Base(key)
	sourceProductID = fmt.Sprintf("mast:TESS/product/%s", bronzeFilename)

	baseName = strings.TrimSuffix(bronzeFilename, ".fits")
	baseName = strings.TrimSuffix(baseName, ".fit")
	baseName = strings.TrimSuffix(baseName, "_lc")
	baseName = strings.TrimSuffix(baseName, "_tp")

	if m := ticRegex.FindStringSubmatch(key); len(m) > 1 {
		ticID = m[1]
	} else {
		ticID = "—"
	}

	if m := sectorRegex.FindStringSubmatch(key); len(m) > 1 {
		if s, err := strconv.Atoi(m[1]); err == nil {
			sector = &s
		}
	}
	return
}

func parseSilverKey(key string) (sourceProductID string, baseName string, processorVersion string) {
	if m := processorRegex.FindStringSubmatch(key); len(m) > 1 {
		processorVersion = m[1]
	}

	const marker = "mast:TESS/product/"
	if idx := strings.Index(key, marker); idx >= 0 && strings.HasSuffix(key, ".parquet") {
		sourceProductID = strings.TrimSuffix(key[idx:], ".parquet")
	} else if strings.HasSuffix(key, ".parquet") {
		sourceProductID = strings.TrimSuffix(path.Base(key), ".parquet")
	}

	baseName = strings.TrimSuffix(path.Base(key), ".parquet")
	baseName = strings.TrimSuffix(baseName, "_lc")
	baseName = strings.TrimSuffix(baseName, "_tp")
	return
}

func parseLineageKey(key string) string {
	base := path.Base(key)
	return strings.TrimSuffix(base, ".json")
}

func cleanETag(etag string) string {
	return strings.ReplaceAll(etag, "\"", "")
}
