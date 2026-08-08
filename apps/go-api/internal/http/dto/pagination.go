package dto

const (
	DefaultPageSize = 100
	MaxPageSize     = 1000
	MaxOffset       = 10_000_000
)

type PageRequest struct {
	Limit  int `form:"limit" json:"limit"`
	Offset int `form:"offset" json:"offset"`
}
