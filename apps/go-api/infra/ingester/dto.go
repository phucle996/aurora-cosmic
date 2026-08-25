package ingester

import (
	"time"

	"go-api/internal/domain/entity"
)

// controlStartRequestDTO is the wire contract owned by the ingester control client.
// The domain command remains independent of HTTP and JSON naming.
type controlStartRequestDTO struct {
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

func controlStartRequestFromEntity(request entity.IngestStartRequest) controlStartRequestDTO {
	return controlStartRequestDTO{
		ManifestPath: request.ManifestPath,
		Sector:       request.Sector,
		Limit:        request.Limit,
		Concurrency:  request.Concurrency,
		Resume:       request.Resume,
		Fresh:        request.Fresh,
	}
}

// controlJobDTO is the response contract of go-ingester's control plane.
type controlJobDTO struct {
	JobID        string    `json:"job_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path"`
	Sector       int       `json:"sector"`
	Concurrency  int       `json:"concurrency"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error"`
}

func (dto controlJobDTO) toEntity() entity.IngestControlJob {
	return entity.IngestControlJob{
		JobID:        dto.JobID,
		Status:       dto.Status,
		ManifestPath: dto.ManifestPath,
		Sector:       dto.Sector,
		Concurrency:  dto.Concurrency,
		StartedAt:    dto.StartedAt,
		UpdatedAt:    dto.UpdatedAt,
		Error:        dto.Error,
	}
}
