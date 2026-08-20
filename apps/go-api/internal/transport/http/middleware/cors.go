package middleware

import (
	"net/http"

	"go-api/internal/config"

	"github.com/gin-gonic/gin"
)

func CORS(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.CORSAllowedOrigin != "" && c.GetHeader("Origin") == cfg.CORSAllowedOrigin {
			c.Header("Access-Control-Allow-Origin", cfg.CORSAllowedOrigin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusOK)
			return
		}
		c.Next()
	}
}
