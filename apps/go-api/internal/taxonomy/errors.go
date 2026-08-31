package taxonomy

import "errors"

var (
	ErrInvalidPage          = errors.New("invalid page parameters")
	ErrInvalidSector        = errors.New("sector must be a positive integer")
	ErrInvalidTargetFilter  = errors.New("invalid target filter")
	ErrMissingSnapshot      = errors.New("snapshot_id is required")
	ErrInvalidSnapshot      = errors.New("snapshot_id contains invalid characters")
	ErrStorageUnavailable   = errors.New("storage is unavailable")
	ErrAnalyticsUnavailable = errors.New("analytical data store is unavailable")
	ErrNotFound             = errors.New("resource not found")
	ErrInvalidManifest      = errors.New("invalid inference job manifest")
	ErrDispatch             = errors.New("failed to queue inference job")
	ErrInvalidRequest       = errors.New("invalid request")
)
