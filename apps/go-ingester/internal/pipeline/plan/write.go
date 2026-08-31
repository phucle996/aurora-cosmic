package plan

import (
	"fmt"
	"os"

	"go-ingester/internal/model"
)

// Write serializes the Manifest struct into formatted JSON file.
func Write(m *model.Manifest, path string) error {
	data, err := marshalIndented(m)
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

	manifest, err := unmarshal(data)
	if err != nil {
		return nil, fmt.Errorf("manifest unmarshal %s: %w", path, err)
	}
	return manifest, nil
}
