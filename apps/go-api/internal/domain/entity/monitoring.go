package entity

import "time"

type MonitoringPoint struct {
	Timestamp float64           `json:"timestamp"`
	Value     float64           `json:"value"`
	Labels    map[string]string `json:"labels,omitempty"`
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
