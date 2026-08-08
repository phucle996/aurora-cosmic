package entity

import "time"

type MonitoringPoint struct {
	Timestamp float64
	Value     float64
}

type MonitoringComponent struct {
	ID        string
	Name      string
	Group     string
	Container string
	Status    string
	Metrics   MonitoringMetrics
}

type MonitoringMetrics struct {
	CPU       []MonitoringPoint
	Memory    []MonitoringPoint
	NetworkRX []MonitoringPoint
	NetworkTX []MonitoringPoint
}

type MonitoringWindow struct {
	Duration time.Duration
	Step     time.Duration
}
