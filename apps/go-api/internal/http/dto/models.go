package dto

// TrainingJobRequest đại diện cho payload yêu cầu huấn luyện mô hình gửi từ Dashboard
type TrainingJobRequest struct {
	Task           string  `json:"task"`
	GoldSnapshotID string  `json:"gold_snapshot_id"`
	BaseModelID    string  `json:"base_model_id,omitempty"` // Model ID gốc làm nền tảng (e.g. "champion", "model-cand-v1-...", hoặc "" để train từ đầu)
	TrainingMode   string  `json:"training_mode,omitempty"` // "fine_tune" (kế thừa trọng số) hoặc "scratch" (tạo mới ngẫu nhiên)
	Epochs         int     `json:"epochs"`
	LearningRate   float64 `json:"learning_rate"`
	BatchSize      int     `json:"batch_size"`
	Seed           int     `json:"seed"`
	AutoPromote    bool    `json:"auto_promote"`
}

// TrainingJobResponse đại diện cho dữ liệu phản hồi sau khi xếp hàng huấn luyện thành công
type TrainingJobResponse struct {
	JobID          string `json:"job_id"`
	Task           string `json:"task"`
	GoldSnapshotID string `json:"gold_snapshot_id"`
	Status         string `json:"status"`
	CreatedAt      string `json:"created_at"`
	Message        string `json:"message"`
}
