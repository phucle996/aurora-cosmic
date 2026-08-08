package repo

import (
	"context"
	"time"
)

type ObjectInfo struct {
	Key          string
	Size         int64
	ETag         string
	LastModified time.Time
}

type ObjectRepository interface {
	Ping(context.Context) error
	ListObjects(context.Context, string) ([]ObjectInfo, error)
	GetObject(context.Context, string) ([]byte, error)
}
