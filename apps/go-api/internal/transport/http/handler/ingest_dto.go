package handler

import (
	"time"

	"go-api/internal/domain/entity"
)

// ingestStartRequestDTO is the public HTTP request contract for an ingest run.
type ingestStartRequestDTO struct {
	ManifestPath string `json:"manifest_path"`
	Sector       int    `json:"sector"`
	Limit        int    `json:"limit"`
	Concurrency  int    `json:"concurrency"`
	Resume       bool   `json:"resume"`
	Fresh        bool   `json:"fresh"`
}

func (dto ingestStartRequestDTO) toEntity() entity.IngestStartRequest {
	return entity.IngestStartRequest{
		ManifestPath: dto.ManifestPath,
		Sector:       dto.Sector,
		Limit:        dto.Limit,
		Concurrency:  dto.Concurrency,
		Resume:       dto.Resume,
		Fresh:        dto.Fresh,
	}
}

type ingestProductResponseDTO struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	ObjectKey string    `json:"object_key"`
	State     string    `json:"state"`
	SizeBytes int64     `json:"size_bytes"`
	Expected  int64     `json:"expected_size_bytes"`
	Attempts  int       `json:"attempts"`
	LastError string    `json:"last_error,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ingestStatusResponseDTO struct {
	Observed          bool                                `json:"observed"`
	Source            string                              `json:"source"`
	RunID             string                              `json:"run_id"`
	ControlJobID      string                              `json:"control_job_id"`
	Status            string                              `json:"status"`
	Error             string                              `json:"error,omitempty"`
	ManifestPath      string                              `json:"manifest_path"`
	StartedAt         time.Time                           `json:"started_at"`
	UpdatedAt         time.Time                           `json:"updated_at"`
	TotalProducts     int                                 `json:"total_products"`
	CompletedProducts int                                 `json:"completed_products"`
	Downloading       int                                 `json:"downloading"`
	FailedProducts    int                                 `json:"failed_products"`
	ExpectedBytes     int64                               `json:"expected_bytes"`
	CompletedBytes    int64                               `json:"completed_bytes"`
	ProductsPerSecond float64                             `json:"products_per_second"`
	BytesPerSecond    float64                             `json:"bytes_per_second"`
	QueueDepth        float64                             `json:"queue_depth"`
	InflightProducts  float64                             `json:"inflight_products"`
	ObservedAt        time.Time                           `json:"observed_at"`
	Products          []ingestProductResponseDTO          `json:"products"`
	ProductsTruncated bool                                `json:"products_truncated"`
	ProductKinds      map[string]entity.IngestKindSummary `json:"product_kinds"`
	CatalogProgress   *entity.IngestCatalogProgress       `json:"catalog_progress,omitempty"`
	ManifestProgress  *entity.IngestManifestProgress      `json:"manifest_progress,omitempty"`
}

func ingestStatusResponseFromEntity(status entity.IngestStatus) ingestStatusResponseDTO {
	products := make([]ingestProductResponseDTO, len(status.Products))
	for index, product := range status.Products {
		products[index] = ingestProductResponseDTO{
			ID:        product.ID,
			Kind:      product.Kind,
			ObjectKey: product.ObjectKey,
			State:     product.State,
			SizeBytes: product.SizeBytes,
			Expected:  product.Expected,
			Attempts:  product.Attempts,
			LastError: product.LastError,
			UpdatedAt: product.UpdatedAt,
		}
	}
	return ingestStatusResponseDTO{
		Observed:          status.Observed,
		Source:            status.Source,
		RunID:             status.RunID,
		ControlJobID:      status.ControlJobID,
		Status:            status.Status,
		Error:             status.Error,
		ManifestPath:      status.ManifestPath,
		StartedAt:         status.StartedAt,
		UpdatedAt:         status.UpdatedAt,
		TotalProducts:     status.TotalProducts,
		CompletedProducts: status.CompletedProducts,
		Downloading:       status.Downloading,
		FailedProducts:    status.FailedProducts,
		ExpectedBytes:     status.ExpectedBytes,
		CompletedBytes:    status.CompletedBytes,
		ProductsPerSecond: status.ProductsPerSecond,
		BytesPerSecond:    status.BytesPerSecond,
		QueueDepth:        status.QueueDepth,
		InflightProducts:  status.InflightProducts,
		ObservedAt:        status.ObservedAt,
		Products:          products,
		ProductsTruncated: status.ProductsTruncated,
		ProductKinds:      status.ProductKinds,
		CatalogProgress:   status.CatalogProgress,
		ManifestProgress:  status.ManifestProgress,
	}
}

type ingestControlJobResponseDTO struct {
	JobID        string    `json:"job_id"`
	Status       string    `json:"status"`
	ManifestPath string    `json:"manifest_path"`
	Sector       int       `json:"sector"`
	Concurrency  int       `json:"concurrency"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Error        string    `json:"error,omitempty"`
}

func ingestControlJobResponseFromEntity(job entity.IngestControlJob) ingestControlJobResponseDTO {
	return ingestControlJobResponseDTO{
		JobID:        job.JobID,
		Status:       job.Status,
		ManifestPath: job.ManifestPath,
		Sector:       job.Sector,
		Concurrency:  job.Concurrency,
		StartedAt:    job.StartedAt,
		UpdatedAt:    job.UpdatedAt,
		Error:        job.Error,
	}
}

type storageObjectResponseDTO struct {
	Key          string    `json:"key"`
	SizeBytes    int64     `json:"size_bytes"`
	ETag         string    `json:"etag,omitempty"`
	LastModified time.Time `json:"last_modified"`
}

type storageListingResponseDTO struct {
	Bucket     string                     `json:"bucket"`
	Prefix     string                     `json:"prefix"`
	Page       int                        `json:"page"`
	PageSize   int                        `json:"page_size"`
	Total      int                        `json:"total"`
	TotalBytes int64                      `json:"total_bytes"`
	Truncated  bool                       `json:"truncated"`
	Objects    []storageObjectResponseDTO `json:"objects"`
}

func storageListingResponseFromEntity(listing entity.StorageListing) storageListingResponseDTO {
	objects := make([]storageObjectResponseDTO, len(listing.Objects))
	for index, object := range listing.Objects {
		objects[index] = storageObjectResponseDTO{
			Key:          object.Key,
			SizeBytes:    object.SizeBytes,
			ETag:         object.ETag,
			LastModified: object.LastModified,
		}
	}

	return storageListingResponseDTO{
		Bucket:     listing.Bucket,
		Prefix:     listing.Prefix,
		Page:       listing.Page,
		PageSize:   listing.PageSize,
		Total:      listing.Total,
		TotalBytes: listing.TotalBytes,
		Truncated:  listing.Truncated,
		Objects:    objects,
	}
}
