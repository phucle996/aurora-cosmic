package dto

const (
	DefaultPageSize = 100
	MaxPageSize     = 1000
	MaxOffset       = 10_000_000
)

type CandidateQueryRequest struct {
	Sector     int    `form:"sector" json:"sector"`
	SnapshotID string `form:"snapshot_id" json:"snapshot_id" binding:"required"`
	Limit      int    `form:"limit" json:"limit"`
	Offset     int    `form:"offset" json:"offset"`
}

type AnomalyQueryRequest struct {
	Sector      int    `form:"sector" json:"sector"`
	SnapshotID  string `form:"snapshot_id" json:"snapshot_id" binding:"required"`
	OnlyFlagged *bool  `form:"only_flagged" json:"only_flagged"`
	Limit       int    `form:"limit" json:"limit"`
	Offset      int    `form:"offset" json:"offset"`
}

type TargetQueryRequest struct {
	TICID          int64   `form:"tic_id" json:"tic_id"`
	Sector         int     `form:"sector" json:"sector"`
	TessMagMin     float64 `form:"tmag_min" json:"tmag_min"`
	TessMagMax     float64 `form:"tmag_max" json:"tmag_max"`
	EffectiveTMin  float64 `form:"teff_min" json:"teff_min"`
	EffectiveTMax  float64 `form:"teff_max" json:"teff_max"`
	RAMin          float64 `form:"ra_min" json:"ra_min"`
	RAMax          float64 `form:"ra_max" json:"ra_max"`
	DecMin         float64 `form:"dec_min" json:"dec_min"`
	DecMax         float64 `form:"dec_max" json:"dec_max"`
	PipelineStatus string  `form:"pipeline_status" json:"pipeline_status"`
	HasLightcurve  string  `form:"has_lightcurve" json:"has_lightcurve"`
	HasCandidate   string  `form:"has_candidate" json:"has_candidate"`
	HasAnomaly     string  `form:"has_anomaly" json:"has_anomaly"`
	Sort           string  `form:"sort" json:"sort"`
	Limit          int     `form:"limit" json:"limit"`
	Offset         int     `form:"offset" json:"offset"`
}

type LightcurveQueryRequest struct {
	TICID  int64 `form:"tic_id" json:"tic_id" binding:"required"`
	Sector int   `form:"sector" json:"sector"`
	Limit  int   `form:"limit" json:"limit"`
	Offset int   `form:"offset" json:"offset"`
}
