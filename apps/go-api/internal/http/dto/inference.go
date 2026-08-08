package dto

type ModelsQueryRequest struct {
	Task string `form:"task" json:"task"`
}

type InferenceJobsQueryRequest struct {
	Task    string `form:"task" json:"task"`
	ModelID string `form:"model_id" json:"model_id"`
}

type RetryInferenceJobRequest struct {
	JobID string `uri:"job_id" json:"job_id" binding:"required"`
}
