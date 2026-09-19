package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"go-api/internal/domain/entity"
)

type lakehouseServiceStub struct{}

func (lakehouseServiceStub) List(_ context.Context, q entity.LakehouseListingQuery) (*entity.LakehouseListing, error) {
	return &entity.LakehouseListing{
		Bucket:  "aurora",
		Prefix:  q.Prefix,
		Objects: []entity.LakehouseObject{{Key: q.Prefix + "item.parquet", Tier: "silver", Format: "parquet"}},
	}, nil
}

func (lakehouseServiceStub) Preview(_ context.Context, q entity.LakehousePreviewQuery) (*entity.LakehousePreviewResponse, error) {
	return &entity.LakehousePreviewResponse{
		Key:    q.Key,
		Format: "json",
	}, nil
}

func TestLakehouseHandler_Endpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	h := NewLakehouseHandler(lakehouseServiceStub{})

	router.GET("/lakehouse/objects", h.List)
	router.GET("/lakehouse/preview", h.Preview)

	// 1. List
	req := httptest.NewRequest(http.MethodGet, "/lakehouse/objects?prefix=silver/", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// 2. Preview - missing key
	req = httptest.NewRequest(http.MethodGet, "/lakehouse/preview", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing key, got %d", w.Code)
	}

	// 3. Preview - invalid key with path traversal
	req = httptest.NewRequest(http.MethodGet, "/lakehouse/preview?key=../secret.json", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for path traversal key, got %d", w.Code)
	}

	// 4. Preview - invalid key with leading slash
	req = httptest.NewRequest(http.MethodGet, "/lakehouse/preview?key=/root.fits", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for leading slash key, got %d", w.Code)
	}

	// 5. Preview - with valid key
	req = httptest.NewRequest(http.MethodGet, "/lakehouse/preview?key=silver/test.parquet", nil)
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid key, got %d", w.Code)
	}
}
