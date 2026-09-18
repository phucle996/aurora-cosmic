package entity

type PageRequest struct {
	Limit  int
	Offset int
}

type PageMetadata struct {
	Count   int  `json:"count"`
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
}

type Page[T any] struct {
	Items   []T
	Count   int
	Limit   int
	Offset  int
	HasMore bool
}

func (p Page[T]) Metadata() PageMetadata {
	return PageMetadata{
		Count:   p.Count,
		Limit:   p.Limit,
		Offset:  p.Offset,
		HasMore: p.HasMore,
	}
}
