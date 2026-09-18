package middleware

import (
	"time"

	"go-api/internal/provider"

	"github.com/gin-gonic/gin"
)

// Metrics records completed requests using Gin's route template. It must run
// before the router dispatches so c.FullPath() is available after c.Next().
func Metrics(metrics *provider.Metrics) gin.HandlerFunc {
	if metrics == nil {
		return func(c *gin.Context) {
			c.Next()
		}
	}
	return func(c *gin.Context) {
		started := time.Now()
		metrics.RequestStarted()
		defer metrics.RequestFinished()
		c.Next()
		metrics.ObserveRequest(c.Request.Method, c.FullPath(), c.Writer.Status(), time.Since(started))
	}
}
