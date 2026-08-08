package dto

type CandidateQueryRequest struct {
	Sector     int    `form:"sector" json:"sector"`
	SnapshotID string `form:"snapshot_id" json:"snapshot_id" binding:"required"`
	PageRequest
}

type AnomalyQueryRequest struct {
	Sector     int    `form:"sector" json:"sector"`
	SnapshotID string `form:"snapshot_id" json:"snapshot_id" binding:"required"`
	PageRequest
}

type TargetQueryRequest struct {
	Sector int `form:"sector" json:"sector"`
	PageRequest
}

type LightcurveQueryRequest struct {
	TICID int64 `form:"tic_id" json:"tic_id" binding:"required"`
	PageRequest
}
