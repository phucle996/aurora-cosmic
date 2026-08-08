package tests

import (
	"testing"

	storageinfra "go-ingester/infra/storage"
)

func TestNewMinIOClientAcceptsComposeURL(t *testing.T) {
	if _, err := storageinfra.NewMinIOClient("http://minio:9000", "minioadmin", "minioadmin"); err != nil {
		t.Fatalf("compose-style MinIO endpoint should be accepted: %v", err)
	}
	if _, err := storageinfra.NewMinIOClient("https://minio.example:9443", "key", "secret"); err != nil {
		t.Fatalf("HTTPS MinIO endpoint should be accepted: %v", err)
	}
}

func TestNewMinIOClientRejectsEndpointPath(t *testing.T) {
	if _, err := storageinfra.NewMinIOClient("http://minio:9000/api", "key", "secret"); err == nil {
		t.Fatal("expected endpoint path to be rejected")
	}
}
