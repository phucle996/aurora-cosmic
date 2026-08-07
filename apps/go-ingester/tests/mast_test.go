package tests

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go-ingester/internal/mast"
)

func TestOpenProductSuccess(t *testing.T) {
	expectedData := "mock fits content binary data"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("uri") != "mast:TESS/product.fits" {
			http.Error(w, "invalid uri", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/fits")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedData))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	client.SetDownloadURL(ts.URL)

	stream, size, err := client.OpenProduct(context.Background(), "mast:TESS/product.fits")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer stream.Close()

	body, err := io.ReadAll(stream)
	if err != nil {
		t.Fatalf("failed reading stream: %v", err)
	}
	if string(body) != expectedData {
		t.Errorf("got content %q, want %q", string(body), expectedData)
	}
	if size != int64(len(expectedData)) {
		t.Errorf("got content length %d, want %d", size, len(expectedData))
	}
}

func TestOpenProductRetryOn503ThenSuccess(t *testing.T) {
	attempts := 0
	expectedData := "recovered binary fits data"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 2 {
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(expectedData))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	client.SetDownloadURL(ts.URL)

	stream, _, err := client.OpenProduct(context.Background(), "mast:TESS/test.fits")
	if err != nil {
		t.Fatalf("expected success after retry, got error: %v", err)
	}
	defer stream.Close()

	if attempts != 2 {
		t.Errorf("expected 2 attempts, got %d", attempts)
	}
}

func TestOpenProductPermanentFailure(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	client.SetDownloadURL(ts.URL)

	_, _, err := client.OpenProduct(context.Background(), "mast:TESS/missing.fits")
	if err == nil {
		t.Fatal("expected error on 404, got nil")
	}
}
