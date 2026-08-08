package middleware

import (
	"time"

	"go-api/internal/observer"

	"github.com/gin-gonic/gin"
)

// Metrics records completed requests using Gin's route template. It must run
// before the router dispatches so c.FullPath() is available after c.Next().
func Metrics(metrics *observer.Metrics) gin.HandlerFunc {
	return func(c *gin.Context) {
		if metrics == nil {
			c.Next()
			return
		}
		started := time.Now()
		metrics.RequestStarted()
		defer metrics.RequestFinished()
		c.Next()
		metrics.ObserveRequest(c.Request.Method, c.FullPath(), c.Writer.Status(), time.Since(started))
	}
}
