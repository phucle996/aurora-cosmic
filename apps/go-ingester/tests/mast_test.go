package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"go-ingester/infra/mast"
	"go-ingester/internal/model"
)

func fitsCard(key string, value int) string {
	return fmt.Sprintf("%-80s", fmt.Sprintf("%-8s= %20d", key, value))
}

func TestDiscoverTESSOnlyReturnsTargetProductsWhenSampleLimitIsBounded(t *testing.T) {
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
		switch request["service"] {
		case "Mast.Caom.Filtered":
			if request["pagesize"] != float64(2) || request["page"] != float64(1) {
				t.Errorf("expected filtered pagesize=2/page=1, got pagesize=%v page=%v", request["pagesize"], request["page"])
			}
			if containsProductType(request, "image") {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{{CatalogID: 42, ObsID: "tess-s0001-1-3", DataProductType: "image"}}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{{ObsID: "obs-1", TargetName: "TIC 1", DataProductType: "timeseries", DataURL: "mast:one.fits"}, {ObsID: "obs-2", TargetName: "TIC 2", DataProductType: "timeseries", DataURL: "mast:two.fits"}}})
		default:
			t.Errorf("unexpected MAST service %q", request["service"])
		}
	}))
	defer ts.Close()

	client := mast.NewClient(ts.URL, 5*time.Second)
	products, err := mast.DiscoverTESS(context.Background(), client, mast.DiscoverOptions{Limit: 2, PageSize: 2}, slog.Default())
	if err != nil {
		t.Fatalf("unexpected discovery error: %v", err)
	}
	if len(products) != 2 {
		t.Fatalf("expected only two target products, got %d", len(products))
	}
	if products[0].Kind != model.KindLightCurve || products[0].Filename != "one.fits" {
		t.Fatalf("expected CAOM timeseries to become a light-curve product, got kind=%s filename=%q", products[0].Kind, products[0].Filename)
	}
}

func TestDiscoverTESSKeepsConfiguredPageSizeAndReportsMeasuredProgress(t *testing.T) {
	var pageSizes []int
	var progress []mast.DiscoverProgress
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		var request map[string]any
		if err := json.Unmarshal([]byte(r.FormValue("request")), &request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		pageSize := int(request["pagesize"].(float64))
		page := int(request["page"].(float64))
		pageSizes = append(pageSizes, pageSize)
		rows := []mast.Observation{
			{TargetName: "TIC 1", DataURL: "mast:TESS/product/one_lc.fits"},
			{TargetName: "TIC 2", DataURL: "mast:TESS/product/two_lc.fits"},
		}
		if page == 2 {
			rows = []mast.Observation{{TargetName: "TIC 3", DataURL: "mast:TESS/product/three_lc.fits"}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "COMPLETE",
			"data":   rows,
			"paging": map[string]any{"rowsTotal": 3},
		})
	}))
	defer ts.Close()

	products, err := mast.DiscoverTESS(context.Background(), mast.NewClient(ts.URL, 5*time.Second), mast.DiscoverOptions{
		Sector:   1,
		PageSize: 2,
		Progress: func(update mast.DiscoverProgress) { progress = append(progress, update) },
	}, slog.Default())
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(pageSizes) != 2 || pageSizes[0] != 2 || pageSizes[1] != 2 {
		t.Fatalf("unbounded discovery changed configured page size: %v", pageSizes)
	}
	if len(products) != 6 {
		t.Fatalf("expected three TPF/LC pairs, got %d products", len(products))
	}
	last := progress[len(progress)-1]
	if last.Stage != "RESOLVING_MAST_PRODUCTS" || last.Completed != 3 || last.Total != 3 || last.Products != 6 {
		t.Fatalf("unexpected final progress: %+v", last)
	}
}

func TestDiscoverTESSDoesNotQueryImageOrFFIParents(t *testing.T) {
	var productParentIDs []string
	var serverURL string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/target_tp.fits" {
			if r.Header.Get("Range") != "bytes=0-65535" {
				t.Errorf("detector probe missing range header")
			}
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(fitsCard("SIMPLE", 1) + fitsCard("CAMERA", 3) + fitsCard("CCD", 2) + fmt.Sprintf("%-80s", "END")))
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse MAST form: %v", err)
			return
		}
		var request map[string]any
		if err := json.Unmarshal([]byte(r.FormValue("request")), &request); err != nil {
			t.Errorf("invalid MAST request: %v", err)
			return
		}
		switch request["service"] {
		case "Mast.Caom.Filtered":
			if containsProductType(request, "image") || containsFilterParam(request, "obs_id") {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{
					{CatalogID: 32, ObsID: "tess-s0001-3-2", DataProductType: "image", Region: "POLYGON 0 0 2 0 2 2 0 2"},
					{CatalogID: 11, ObsID: "tess-s0001-1-1", DataProductType: "image", Region: "POLYGON 10 10 12 10 12 12 10 12"},
				}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{
				{CatalogID: 42, ObsID: "target", TargetName: "TIC 42", SequenceNumber: 1, DataProductType: "timeseries", DataURL: serverURL + "/target_lc.fits", RA: 1, Dec: 1},
			}})
		case "Mast.Caom.Products":
			params, _ := request["params"].(map[string]any)
			parentID := fmt.Sprint(params["obsid"])
			if parentID == "42" {
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{
					{ObsID: "target", ProductFilename: "target_tp.fits", DataURL: serverURL + "/target_tp.fits"},
					{ObsID: "target", ProductFilename: "target_lc.fits", DataURL: serverURL + "/target_lc.fits"},
				}})
				return
			}
			productParentIDs = append(productParentIDs, parentID)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{{
				ObsID: "shared-parent", ProductFilename: "tess-s0001-3-2-s_ffic.fits", DataURL: "mast:TESS/product/tess-s0001-3-2-s_ffic.fits", DataProductType: "image",
			}}})
		default:
			t.Errorf("unexpected MAST service %q", request["service"])
		}
	}))
	defer ts.Close()
	serverURL = ts.URL

	products, err := mast.DiscoverTESS(context.Background(), mast.NewClient(ts.URL, 5*time.Second), mast.DiscoverOptions{Sector: 1, Limit: 1, PageSize: 100}, slog.Default())
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if len(productParentIDs) != 0 {
		t.Fatalf("queried unexpected image/FFI parents=%v", productParentIDs)
	}
	if len(products) != 2 || products[0].Kind != model.KindTargetPixel || products[1].Kind != model.KindLightCurve {
		t.Fatalf("products=%#v, want one TPF + LC pair", products)
	}
}

func containsProductType(request map[string]any, expected string) bool {
	params, _ := request["params"].(map[string]any)
	filters, _ := params["filters"].([]any)
	for _, item := range filters {
		filter, _ := item.(map[string]any)
		if filter["paramName"] != "dataproduct_type" {
			continue
		}
		values, _ := filter["values"].([]any)
		for _, value := range values {
			if value == expected {
				return true
			}
		}
	}
	return false
}

func containsFilterParam(request map[string]any, expected string) bool {
	params, _ := request["params"].(map[string]any)
	filters, _ := params["filters"].([]any)
	for _, item := range filters {
		filter, _ := item.(map[string]any)
		if filter["paramName"] == expected {
			return true
		}
	}
	return false
}

func TestDiscoverTESSSuffixWinsOverAmbiguousTimeseriesMetadata(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []mast.Observation{{
			ObsID: "tess-s0001", TargetName: "TIC 44577667", DataProductType: "timeseries",
			ProductFilename: "tess2018206045859-s0001-0000000044577667-0120-s_tp.fits",
		}}})
	}))
	defer ts.Close()

	products, err := mast.DiscoverTESS(context.Background(), mast.NewClient(ts.URL, 5*time.Second), mast.DiscoverOptions{Sector: 1, Limit: 1}, slog.Default())
	if err != nil {
		t.Fatalf("unexpected discovery error: %v", err)
	}
	if len(products) != 1 || products[0].Kind != model.KindTargetPixel {
		t.Fatalf("_tp.fits must be TARGET_PIXEL even when MAST says timeseries, got %#v", products)
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

func TestMASTQueryRetriesAfterMetadataAttemptTimeout(t *testing.T) {
	var calls int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			time.Sleep(100 * time.Millisecond)
			return
		}
		_, _ = w.Write([]byte(`{"status":"COMPLETE","data":[]}`))
	}))
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	body, err := mast.NewClient(ts.URL, 25*time.Millisecond).Query(ctx, url.Values{"request": []string{"{}"}})
	if err != nil {
		t.Fatalf("expected retry on a stalled MAST node: %v", err)
	}
	if calls != 2 || string(body) != `{"status":"COMPLETE","data":[]}` {
		t.Fatalf("calls=%d body=%s", calls, body)
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
		{"FFI", "", model.KindUnknown},
		{"FFIC", "", model.KindUnknown},
		{"UNKNOWN_KIND", "something else", model.KindUnknown},
	}

	for _, tt := range tests {
		obs := mast.Observation{
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
