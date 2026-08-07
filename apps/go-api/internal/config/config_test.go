package config

import "testing"

func TestConfigValidation(t *testing.T) {
	cfg := &Config{Server: ServerConfig{Port: 8080}}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected valid config, got: %v", err)
	}

	cfgInvalidPort := &Config{Server: ServerConfig{Port: 70000}}
	if err := cfgInvalidPort.Validate(); err == nil {
		t.Fatal("expected error for port 70000, got nil")
	}
}
