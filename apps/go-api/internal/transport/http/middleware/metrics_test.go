package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-api/internal/observer"

	"github.com/gin-gonic/gin"
)

func TestMetricsMiddlewareUsesGinRouteTemplate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	metrics := observer.New()
	engine := gin.New()
	engine.Use(Metrics(metrics))
	engine.GET("/models/:model_id", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/models/model-123", nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("unexpected response status: %d", recorder.Code)
	}

	scrape := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(scrape, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, err := io.ReadAll(scrape.Result().Body)
	if err != nil {
		t.Fatalf("read metrics: %v", err)
	}
	text := string(body)
	if !strings.Contains(text, `route="/models/:model_id"`) {
		t.Fatal("expected route template in metrics")
	}
	if strings.Contains(text, "model-123") {
		t.Fatal("raw model ID leaked into metrics")
	}
}
