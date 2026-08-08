package http

import (
	"net/http"
	"regexp"
	"strconv"

	"go-api/internal/store"
)

const (
	defaultPageSize = 100
	maxPageSize     = 1000
	maxOffset       = 10_000_000
)

var snapshotIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

func parsePage(req *http.Request) (store.PageRequest, error) {
	page := store.PageRequest{Limit: defaultPageSize}
	values := req.URL.Query()
	if raw := values.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageSize {
			return store.PageRequest{}, errInvalidPage
		}
		page.Limit = limit
	}
	if raw := values.Get("offset"); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxOffset {
			return store.PageRequest{}, errInvalidPage
		}
		page.Offset = offset
	}
	return page, nil
}

func parseSector(req *http.Request) (int, error) {
	raw := req.URL.Query().Get("sector")
	if raw == "" {
		return 0, nil
	}
	sector, err := strconv.Atoi(raw)
	if err != nil || sector < 1 {
		return 0, errInvalidSector
	}
	return sector, nil
}

func parseSnapshotID(req *http.Request, required bool) (string, error) {
	snapshotID := req.URL.Query().Get("snapshot_id")
	if snapshotID == "" {
		if required {
			return "", errMissingSnapshot
		}
		return "", nil
	}
	if !snapshotIDPattern.MatchString(snapshotID) {
		return "", errInvalidSnapshot
	}
	return snapshotID, nil
}

type requestError string

func (e requestError) Error() string { return string(e) }

var (
	errInvalidPage     = requestError("limit must be between 1 and 1000 and offset must be between 0 and 10000000")
	errInvalidSector   = requestError("sector must be a positive integer")
	errMissingSnapshot = requestError("snapshot_id is required")
	errInvalidSnapshot = requestError("snapshot_id contains invalid characters")
)
