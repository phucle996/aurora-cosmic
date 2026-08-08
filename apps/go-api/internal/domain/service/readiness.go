package service

import "context"

type Readiness interface {
	Check(context.Context) (map[string]string, bool)
}
