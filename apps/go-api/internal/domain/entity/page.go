package entity

type PageRequest struct {
	Limit  int
	Offset int
}

type Page[T any] struct {
	Items   []T
	Count   int
	Limit   int
	Offset  int
	HasMore bool
}
