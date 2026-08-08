package dto

type MonitoringQueryRequest struct {
	Range string `form:"range" json:"range"`
	Step  string `form:"step" json:"step"`
}
