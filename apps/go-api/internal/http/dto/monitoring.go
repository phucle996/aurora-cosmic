package dto

type MonitoringQueryRequest struct {
	Tab   string `form:"tab" json:"tab"`
	Range string `form:"range" json:"range"`
	Step  string `form:"step" json:"step"`
}
