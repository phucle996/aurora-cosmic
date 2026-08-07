package manifest

import (
	"encoding/json"
	"fmt"
	"os"

	"go-ingester/internal/model"
)

// Write serializes the Manifest struct into formatted JSON file.
func Write(m *model.Manifest, path string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("manifest marshal: %w", err)
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("manifest write %s: %w", path, err)
	}

	return nil
}

// Read loads and parses a Manifest JSON file from path.
func Read(path string) (*model.Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("manifest read %s: %w", path, err)
	}

	var m model.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("manifest unmarshal %s: %w", path, err)
	}

	return &m, nil
}
