package entity

// Candidate đại diện cho một kết quả dự đoán ứng viên ngoại hành tinh từ mô hình ML (Candidate Vetting CNN).
type Candidate struct {
	PredictionID    string  `json:"prediction_id"`
	SourceProductID string  `json:"source_product_id"`
	TICID           int64   `json:"tic_id"`
	Sector          int     `json:"sector"`
	RawLogit        float64 `json:"raw_logit"`
	CandidateScore  float64 `json:"candidate_score"`
	Threshold       float64 `json:"decision_threshold"`
	AboveThreshold  bool    `json:"above_threshold"`
	ModelVersion    string  `json:"model_version"`
	RegisteredModel string  `json:"registered_model_id"`
	SnapshotID      string  `json:"gold_snapshot_id"`
	ValidationID    string  `json:"runtime_validation_id"`
	RuntimePkgID    string  `json:"runtime_package_id"`
	PredictedAt     string  `json:"predicted_at"`
}

// CandidateEvidence chứa 31 đặc trưng trắc quang và danh mục sao TIC phục vụ kiểm tra chéo khoa học.
type CandidateEvidence struct {
	LineageID                  string  `json:"lineage_id"`
	FeatureVersion             string  `json:"feature_version"`
	FeatureFingerprint         string  `json:"feature_fingerprint"`
	NPoints                    int64   `json:"n_points"`
	TimeSpan                   float64 `json:"time_span"`
	MedianCadence              float64 `json:"median_cadence"`
	MaxGap                     float64 `json:"max_gap"`
	FluxMean                   float64 `json:"flux_mean"`
	FluxStd                    float64 `json:"flux_std"`
	FluxAmplitude              float64 `json:"flux_amplitude"`
	FluxRMS                    float64 `json:"flux_rms"`
	MedianFluxErr              float64 `json:"median_flux_err"`
	BLSAvailable               bool    `json:"bls_available"`
	BLSPeriod                  float64 `json:"bls_period"`
	BLSDuration                float64 `json:"bls_duration"`
	BLSTransitTime             float64 `json:"bls_transit_time"`
	BLSDepth                   float64 `json:"bls_depth"`
	BLSPower                   float64 `json:"bls_power"`
	PixelMADMedian             float64 `json:"pixel_mad_median"`
	VariabilityPeakFraction    float64 `json:"variability_peak_fraction"`
	TransitEvidenceAvailable   bool    `json:"transit_evidence_available"`
	TransitDeficitSum          float64 `json:"transit_deficit_sum"`
	TransitDeficitCenterOffset float64 `json:"transit_deficit_center_offset"`
	TICAvailable               bool    `json:"tic_available"`
	TMag                       float64 `json:"tmag"`
	Teff                       float64 `json:"teff"`
	StellarRadius              float64 `json:"stellar_radius"`
	StellarMass                float64 `json:"stellar_mass"`
	LogG                       float64 `json:"logg"`
	MatchedTOIID               string  `json:"matched_toi_id"`
	TOIMatchStatus             string  `json:"toi_match_status"`
}

// HZFluxBoundaries định nghĩa ranh giới thông lượng bức xạ của vùng có thể sống được (Habitable Zone).
type HZFluxBoundaries struct {
	ConservativeInner float64 `json:"conservative_inner"`
	ConservativeOuter float64 `json:"conservative_outer"`
	OptimisticInner   float64 `json:"optimistic_inner"`
	OptimisticOuter   float64 `json:"optimistic_outer"`
}

// PlanetPhysics chứa các tham số vật lý thiên văn giải tích được suy diễn minh bạch (không tự ý điền bừa).
type PlanetPhysics struct {
	PlanetCandidateID       string           `json:"planet_candidate_id"`
	ModelVersion            string           `json:"model_version"`
	OrbitalPeriodDays       *float64         `json:"orbital_period_days"`
	TransitDepthFraction    *float64         `json:"transit_depth_fraction"`
	PlanetRadiusEarth       *float64         `json:"planet_radius_earth"`
	SemiMajorAxisAU         *float64         `json:"semi_major_axis_au"`
	StellarLuminositySolar  *float64         `json:"stellar_luminosity_solar"`
	InsolationEarth         *float64         `json:"insolation_earth"`
	EquilibriumTemperatureK *float64         `json:"equilibrium_temperature_k"`
	BondAlbedoAssumption    float64          `json:"bond_albedo_assumption"`
	HZClassification        string           `json:"hz_classification"`
	HZFluxBoundaries        HZFluxBoundaries `json:"hz_flux_boundaries"`
	Completeness            float64          `json:"completeness"`
	Warnings                []string         `json:"warnings"`
}

// HabitabilityComponent đại diện cho một tiêu chuẩn chấm điểm trong đánh giá khả năng hỗ trợ sự sống.
type HabitabilityComponent struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	Score     float64 `json:"score"`
	MaxScore  float64 `json:"max_score"`
	Available bool    `json:"available"`
	Reason    string  `json:"reason"`
}

// HabitabilityAssessment là bảng đánh giá tổng hợp khả năng sống được theo vật lý giải tích và ML.
type HabitabilityAssessment struct {
	AssessmentVersion string                  `json:"assessment_version"`
	Status            string                  `json:"status"`
	PhysicsScore      *float64                `json:"physics_score"`
	Confidence        float64                 `json:"confidence"`
	Tier              string                  `json:"tier"`
	Components        []HabitabilityComponent `json:"components"`
	MLScore           *float64                `json:"ml_score"` // Giữ null khi chưa có kết quả mô hình
	MLStatus          string                  `json:"ml_status"`
	Disclaimer        string                  `json:"disclaimer"`
}

// CandidateReview là phán quyết thẩm định khoa học của chuyên gia đối với một ứng viên.
// Tách biệt hoàn toàn khỏi nhãn huấn luyện và không làm biến đổi dữ liệu Gold.
type CandidateReview struct {
	SnapshotID      string `json:"-"`
	PredictionID    string `json:"-"`
	SourceProductID string `json:"-"`
	TICID           int64  `json:"-"`
	Sector          int    `json:"-"`
	Decision        string `json:"decision"`
	ReviewStatus    string `json:"review_status"`
	Reviewer        string `json:"reviewer"`
	Note            string `json:"note"`
	UpdatedAt       string `json:"updated_at"`
}

// CandidateDetail là entity tổng hợp chi tiết một ứng viên, dùng cho endpoint GET /candidates/:prediction_id
type CandidateDetail struct {
	Candidate    Candidate              `json:"candidate"`
	Evidence     CandidateEvidence      `json:"evidence"`
	Review       CandidateReview        `json:"review"`
	Physics      PlanetPhysics          `json:"planet_physics"`
	Habitability HabitabilityAssessment `json:"habitability"`
	SnapshotID   string                 `json:"snapshot_id,omitempty"`
}

// CandidateQuery là flat entity cho luồng tìm kiếm và phân trang danh sách ứng viên
type CandidateQuery struct {
	Sector     int         `json:"sector"`
	SnapshotID string      `json:"snapshot_id"`
	Page       PageRequest `json:"page"`
}

// CandidateReviewInput là flat entity cho luồng thẩm định chuyên gia đối với ứng viên
type CandidateReviewInput struct {
	PredictionID string `json:"prediction_id"`
	SnapshotID   string `json:"snapshot_id"`
	Decision     string `json:"decision"`
	ReviewStatus string `json:"review_status"`
	Reviewer     string `json:"reviewer"`
	Note         string `json:"note"`
}

// CandidateListResponse là flat response entity cho endpoint GET /candidates
type CandidateListResponse struct {
	Task       string       `json:"task"`
	Count      int          `json:"count"`
	Candidates []Candidate  `json:"candidates"`
	Page       PageMetadata `json:"page"`
	SnapshotID string       `json:"snapshot_id"`
}

// CandidateReviewResponse là flat response entity cho endpoint PUT /candidates/:prediction_id/review
type CandidateReviewResponse struct {
	Status string          `json:"status"`
	Review CandidateReview `json:"review"`
}
