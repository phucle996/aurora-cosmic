package entity

// LabelingSnapshotItem là thông tin tóm tắt về một Gold snapshot khả dụng để hiển thị trong Labeling Studio ("Select visible").
type LabelingSnapshotItem struct {
	SnapshotID   string `json:"snapshot_id" ch:"snapshot_id"`
	LastModified string `json:"last_modified" ch:"last_modified"`
	SizeBytes    int64  `json:"size_bytes" ch:"size_bytes"`
	RowCount     int64  `json:"row_count,omitempty" ch:"row_count"`
}

// LabelingCohortDisposition chứa các số liệu tổng hợp của cohort gán nhãn được truy vấn trực tiếp từ ClickHouse (phần trên-phải).
// Loại bỏ hoàn toàn các trường hardcode/chính sách training thừa.
type LabelingCohortDisposition struct {
	TotalRows       int64 `json:"total_rows"`
	PositiveRows    int64 `json:"positive_rows"`
	NegativeRows    int64 `json:"negative_rows"`
	UnresolvedRows  int64 `json:"unresolved_rows"`
	PositiveTargets int64 `json:"positive_targets"`
	NegativeTargets int64 `json:"negative_targets"`
}

// LabelingQueueSummaryItem là dạng projection phẳng của mục tiêu trong hàng đợi gán nhãn (phần dưới-trái).
// Chỉ chứa đúng các trường mà Sidebar Card cần hiển thị và lọc, không lấy thừa dữ liệu.
type LabelingQueueSummaryItem struct {
	SnapshotID      string   `json:"snapshot_id"`
	SourceProductID string   `json:"source_product_id"`
	TICID           int64    `json:"tic_id"`
	Sector          int32    `json:"sector"`
	BLSPower        float64  `json:"bls_power"`
	TOIMatchStatus  string   `json:"toi_match_status"`
	MatchedTOIID    string   `json:"matched_toi_id,omitempty"`
	CandidateScore  *float64 `json:"candidate_score,omitempty"`
	AboveThreshold  *bool    `json:"above_threshold,omitempty"`
}

// LabelingQueuePage chứa danh sách phân trang các mục tiêu cần gán nhãn tóm tắt.
type LabelingQueuePage struct {
	Items      []LabelingQueueSummaryItem `json:"items"`
	TotalCount int64                      `json:"total_count"`
	Limit      int                        `json:"limit"`
	Offset     int                        `json:"offset"`
	HasMore    bool                       `json:"has_more"`
}

// LabelingCohortWorkspace là kết quả đồng bộ nguyên khối (atomic projection) cho Workflow 1:
// Kết hợp Cohort Disposition (phần trên-phải) và Target Queue Summary (phần dưới-trái).
type LabelingCohortWorkspace struct {
	Disposition *LabelingCohortDisposition `json:"disposition"`
	Queue       LabelingQueuePage          `json:"queue"`
}

// LabelingTargetDetail đại diện cho kết quả chiếu phẳng (flat projection) chi tiết của một target (phần dưới-phải).
// Thực thể này mang trực tiếp tag "ch" để ClickHouse quét trực tiếp mà không cần struct trung gian.
type LabelingTargetDetail struct {
	SnapshotID      string  `json:"snapshot_id" ch:"snapshot_id"`
	SourceProductID string  `json:"source_product_id" ch:"source_product_id"`
	TICID           int64   `json:"tic_id" ch:"tic_id"`
	Sector          int32   `json:"sector" ch:"sector"`
	TrainingLabel   string  `json:"training_label" ch:"training_label"`
	LabelSource     string  `json:"label_source" ch:"label_source"`
	ReviewStatus    string  `json:"review_status" ch:"review_status"`
	ReviewReason    string  `json:"review_reason,omitempty" ch:"review_reason"`
	Confidence      float64 `json:"confidence" ch:"confidence"`

	NPoints                          int64    `json:"n_points" ch:"n_points"`
	TimeSpanDays                     float64  `json:"time_span_days" ch:"time_span_days"`
	SectorBaselineDays               float64  `json:"sector_baseline_days" ch:"sector_baseline_days"`
	SectorCoveragePercent            float64  `json:"sector_coverage_percent" ch:"sector_coverage_percent"`
	LargestGapHours                  float64  `json:"largest_gap_hours" ch:"largest_gap_hours"`
	MedianCadenceMinutes             float64  `json:"median_cadence_minutes" ch:"median_cadence_minutes"`
	FluxStdPPM                       float64  `json:"flux_std_ppm" ch:"flux_std_ppm"`
	FluxAmplitudePPM                 float64  `json:"flux_amplitude_ppm" ch:"flux_amplitude_ppm"`
	MedianFluxErrPPM                 float64  `json:"median_flux_err_ppm" ch:"median_flux_err_ppm"`
	BLSAvailable                     bool     `json:"bls_available" ch:"bls_available"`
	BLSPeriodDays                    float64  `json:"bls_period_days" ch:"bls_period_days"`
	BLSDurationHours                 float64  `json:"bls_duration_hours" ch:"bls_duration_hours"`
	BLSTransitTimeBTJD               float64  `json:"bls_transit_time_btjd" ch:"bls_transit_time_btjd"`
	BLSDepthPPM                      float64  `json:"bls_depth_ppm" ch:"bls_depth_ppm"`
	BLSPower                         float64  `json:"bls_power" ch:"bls_power"`
	VariabilityPeakFraction          float64  `json:"variability_peak_fraction" ch:"variability_peak_fraction"`
	TransitEvidenceAvailable         bool     `json:"transit_evidence_available" ch:"transit_evidence_available"`
	TransitDeficitSum                float64  `json:"transit_deficit_sum" ch:"transit_deficit_sum"`
	CentroidOffsetPixels             float64  `json:"centroid_offset_pixels" ch:"centroid_offset_pixels"`
	TransitDeficitCenterOffsetPixels *float64 `json:"transit_deficit_center_offset_pixels,omitempty" ch:"transit_deficit_center_offset_pixels"`
	CentroidRow                      *float64 `json:"centroid_row,omitempty" ch:"centroid_row"`
	CentroidCol                      *float64 `json:"centroid_col,omitempty" ch:"centroid_col"`
	TMag                             *float64 `json:"tmag,omitempty" ch:"tmag"`
	Teff                             *float64 `json:"teff,omitempty" ch:"teff"`
	StellarRadius                    *float64 `json:"stellar_radius,omitempty" ch:"stellar_radius"`
	StellarMass                      *float64 `json:"stellar_mass,omitempty" ch:"stellar_mass"`
	LogG                             *float64 `json:"logg,omitempty" ch:"logg"`
	TOIMatchStatus                   string   `json:"toi_match_status" ch:"toi_match_status"`
	MatchedTOIID                     string   `json:"matched_toi_id" ch:"matched_toi_id"`

	PredictionAvailable bool     `json:"prediction_available,omitempty" ch:"prediction_available"`
	CandidateScore      *float64 `json:"candidate_score,omitempty" ch:"candidate_score"`
	DecisionThreshold   *float64 `json:"decision_threshold,omitempty" ch:"decision_threshold"`
	AboveThreshold      *bool    `json:"above_threshold,omitempty" ch:"above_threshold"`
	ModelID             string   `json:"model_id,omitempty" ch:"model_id"`
	ModelVersion        string   `json:"model_version,omitempty" ch:"model_version"`
	RuntimePackageID    string   `json:"runtime_package_id,omitempty" ch:"runtime_package_id"`
	PredictedAt         string   `json:"predicted_at,omitempty" ch:"predicted_at"`
}
