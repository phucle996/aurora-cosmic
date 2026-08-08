package entity

import "time"

type MonitoringPoint struct {
	Timestamp float64
	Value     float64
}

type MonitoringMetric struct {
	Key    string
	Name   string
	Unit   string
	Kind   string
	Points []MonitoringPoint
}

type MonitoringComponent struct {
	ID        string
	Name      string
	Group     string
	Container string
	Status    string
	Metrics   []MonitoringMetric
}

type MonitoringWindow struct {
	Duration time.Duration
	Step     time.Duration
}

const MonitoringAllTab = "all"

func IsMonitoringTab(tab string) bool {
	switch tab {
	case MonitoringAllTab,
		"go-ingester",
		"rust-preprocessor",
		"python-ml-worker",
		"rust-inference",
		"go-api",
		"minio",
		"nats",
		"clickhouse":
		return true
	default:
		return false
	}
}
