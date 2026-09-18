package stream

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/nats-io/nats.go"
)

const (
	predictionProjectedLive = "aurora.live.ml.prediction.projected"
)

// runPredictionProjector executes the JetStream pull-consumer loop for prediction projection.
func (c *StreamConsumer) runPredictionProjector(ctx context.Context, nc *nats.Conn, subscription *nats.Subscription, done chan<- struct{}) {
	defer close(done)

	// Initial startup reconciliation
	if rows, err := c.predictions.Reconcile(ctx); err != nil {
		c.log.Warn("Prediction startup reconciliation completed with errors", "inserted_rows", rows, "error", err)
	} else if rows > 0 {
		c.log.Info("Prediction startup reconciliation completed", "inserted_rows", rows)
	}

	for ctx.Err() == nil {
		messages, err := subscription.Fetch(1, nats.MaxWait(time.Second))
		if err != nil {
			if ctx.Err() != nil || errors.Is(err, nats.ErrBadSubscription) {
				return
			}
			if errors.Is(err, nats.ErrTimeout) {
				continue
			}
			c.log.Warn("Prediction projector fetch failed", "error", err)
			continue
		}

		for _, message := range messages {
			projectionCtx, cancel := context.WithTimeout(ctx, time.Minute)
			result, projectErr := c.predictions.ProjectCompletion(projectionCtx, message.Data)
			cancel()

			if projectErr != nil {
				c.log.Error("Prediction projection failed; scheduling retry", "error", projectErr)
				if err := message.NakWithDelay(5 * time.Second); err != nil {
					c.log.Warn("Prediction projection NAK failed", "error", err)
				}
				continue
			}

			livePayload, err := json.Marshal(map[string]any{
				"schema_version":  1,
				"event_id":        "prediction-projected-v1-" + result.SourceEventID,
				"event_type":      predictionProjectedLive,
				"occurred_at":     time.Now().UTC().Format(time.RFC3339Nano),
				"source_event_id": result.SourceEventID,
				"job_id":          result.JobID,
				"ticket_id":       result.TicketID,
				"output_key":      result.OutputKey,
				"projected_rows":  result.InsertedRows,
				"expected_rows":   result.ExpectedRows,
				"status":          "ready",
				"producer":        "go-api",
			})
			if err != nil {
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}

			if err := nc.Publish(predictionProjectedLive, livePayload); err != nil {
				c.log.Warn("Prediction projected SSE signal failed", "error", err)
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}

			if err := nc.FlushTimeout(5 * time.Second); err != nil {
				c.log.Warn("Prediction projected SSE flush failed", "error", err)
				_ = message.NakWithDelay(5 * time.Second)
				continue
			}

			if err := message.AckSync(nats.Context(ctx)); err != nil {
				c.log.Warn("Prediction completion ACK failed", "job_id", result.JobID, "error", err)
			}
		}
	}
}
