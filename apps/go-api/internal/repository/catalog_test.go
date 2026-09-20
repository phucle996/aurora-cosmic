package repository

import (
	"testing"
	"time"
)

func TestParseCatalogObjectKeepsUnknownSectorUnscoped(t *testing.T) {
	object := ParseCatalogObject("gold/snapshots/gold-v1-example/manifest.json", 42, "etag", time.Now())
	if object.Sector != 0 {
		t.Fatalf("unknown sector was fabricated as %d", object.Sector)
	}
}
