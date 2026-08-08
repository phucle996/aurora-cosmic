package tests

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
)

func TestDiscoverTESSHonorsBoundedLimitAndPaging(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse MAST form: %v", err)
			return
		}
		var request map[string]any
		if err := json.Unmarshal([]byte(r.FormValue("request")), &request); err != nil {
			t.Errorf("invalid MAST request: %v", err)
			return
		}
		if request["pagesize"] != float64(2) || request["page"] != float64(1) {
			t.Errorf("expected pagesize=2/page=1, got pagesize=%v page=%v", request["pagesize"], request["page"])
		}

		data := []model.Observation{
			{ObsID: "obs-1", TargetName: "TIC 1", DataProductType: "timeseries", DataURL: "mast:one.fits"},
			{ObsID: "obs-2", TargetName: "TIC 2", DataProductType: "timeseries", DataURL: "mast:two.fits"},
			{ObsID: "obs-3", TargetName: "TIC 3", DataProductType: "timeseries", DataURL: "mast:three.fits"},
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	products, err := mast.DiscoverTESS(context.Background(), client, mast.DiscoverOptions{Limit: 2, PageSize: 2}, slog.Default())
	if err != nil {
		t.Fatalf("unexpected discovery error: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected 2 bounded products, got %d", len(products))
	}
	if products[0].Kind != model.KindLightCurve || products[0].Filename != "one.fits" {
		t.Fatalf("expected CAOM timeseries to become a light-curve product, got kind=%s filename=%q", products[0].Kind, products[0].Filename)
	}
}

func TestMASTQueryPollsExecutingResponse(t *testing.T) {
	calls := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			_, _ = w.Write([]byte(`{"status":"EXECUTING"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"COMPLETE","data":[]}`))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	body, err := client.Query(context.Background(), url.Values{"request": []string{"{}"}})
	if err != nil {
		t.Fatalf("unexpected query error: %v", err)
	}
	if calls != 2 {
		t.Fatalf("expected 2 polling requests, got %d", calls)
	}
	if string(body) != `{"status":"COMPLETE","data":[]}` {
		t.Fatalf("unexpected final response: %s", body)
	}
}

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

func TestOpenProductMASTURIUsesDownloadGet(t *testing.T) {
	const payload = "MAST_FITS_PAYLOAD"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET download request, got %s", r.Method)
		}
		if got := r.URL.Query().Get("uri"); got != "mast:TESS/product/sample_lc.fits" {
			t.Fatalf("unexpected download URI %q", got)
		}
		_, _ = w.Write([]byte(payload))
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	client.SetDownloadURL(ts.URL)
	rc, size, err := client.OpenProduct(context.Background(), "mast:TESS/product/sample_lc.fits")
	if err != nil {
		t.Fatalf("unexpected download error: %v", err)
	}
	defer rc.Close()
	if size != int64(len(payload)) {
		t.Fatalf("expected content length %d, got %d", len(payload), size)
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
