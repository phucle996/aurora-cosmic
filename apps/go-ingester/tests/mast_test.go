package tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go-ingester/internal/mast"
	"go-ingester/internal/model"
)

func TestClassifyProduct(t *testing.T) {
	tests := []struct {
		subGroup string
		desc     string
		expected model.ProductKind
	}{
		{"TARGETPIXEL", "", model.KindTargetPixel},
		{"TARG", "", model.KindTargetPixel},
		{"TP", "", model.KindTargetPixel},
		{"LIGHTCURVE", "", model.KindLightCurve},
		{"LC", "", model.KindLightCurve},
		{"FFI", "", model.KindFFI},
		{"FFIC", "", model.KindFFI},
		{"UNKNOWN_KIND", "something else", model.KindUnknown},
	}

	for _, tt := range tests {
		obs := model.Observation{
			ProductSubGroup: tt.subGroup,
			Description:     tt.desc,
		}
		got := mast.ClassifyProduct(obs)
		if got != tt.expected {
			t.Errorf("ClassifyProduct(subGroup=%q, desc=%q) = %q; want %q", tt.subGroup, tt.desc, got, tt.expected)
		}
	}
}

func TestOpenProductSuccess(t *testing.T) {
	expectedPayload := "SIMPLE  = T / FITS DATA HEADER"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedPayload))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	rc, size, err := client.OpenProduct(context.Background(), ts.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer rc.Close()

	if size != int64(len(expectedPayload)) {
		t.Errorf("expected size %d, got %d", len(expectedPayload), size)
	}
}

func TestOpenProductRetryOn503ThenSuccess(t *testing.T) {
	attempts := 0
	expectedPayload := "RETRIED_FITS_DATA"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedPayload))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	rc, _, err := client.OpenProduct(context.Background(), ts.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer rc.Close()

	if attempts != 2 {
		t.Errorf("expected 2 attempts, got %d", attempts)
	}
}

func TestOpenProductPermanentFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	_, _, err := client.OpenProduct(context.Background(), ts.URL)
	if err == nil {
		t.Errorf("expected error on 404, got nil")
	}
}
