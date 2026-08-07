package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Write serialises m as indented JSON and atomically writes it to path.
// It writes to a temp file in the same directory then renames to avoid
// leaving a partial file on crash.
func Write(m *Manifest, path string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("manifest: marshal: %w", err)
	}

	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".manifest-*.json.tmp")
	if err != nil {
		return fmt.Errorf("manifest: create temp file: %w", err)
	}
	tmpName := tmp.Name()

	_, writeErr := tmp.Write(data)
	closeErr := tmp.Close()

	if writeErr != nil {
		os.Remove(tmpName)
		return fmt.Errorf("manifest: write temp: %w", writeErr)
	}
	if closeErr != nil {
		os.Remove(tmpName)
		return fmt.Errorf("manifest: close temp: %w", closeErr)
	}

	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("manifest: rename to %s: %w", path, err)
	}
	return nil
}

// Read deserialises a manifest from path and validates the schema version and
// required fields.
func Read(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("manifest: read %s: %w", path, err)
	}

	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("manifest: decode %s: %w", path, err)
	}

	if m.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("manifest: unsupported schema_version %d (expected %d)", m.SchemaVersion, SchemaVersion)
	}
	if m.Source == "" {
		return nil, fmt.Errorf("manifest: missing source field")
	}

	for i, s := range m.Samples {
		if err := validateSample(s); err != nil {
			return nil, fmt.Errorf("manifest: sample[%d]: %w", i, err)
		}
	}

	return &m, nil
}
