package pubsub

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"go-api/internal/domain/entity"

	"github.com/nats-io/nats.go"
)

func (p *NATSPubSub) handleBronzeEvent(_ context.Context, msg *nats.Msg) {
	p.log.Debug("Processing Bronze event from stream", "subject", msg.Subject)
}

func (p *NATSPubSub) handleSilverEvent(_ context.Context, msg *nats.Msg) {
	p.log.Debug("Processing Silver event from stream", "subject", msg.Subject)
}

func (p *NATSPubSub) handleGoldEvent(ctx context.Context, msg *nats.Msg) {
	p.log.Debug("Processing Gold event from stream", "subject", msg.Subject)
	if msg.Subject != "aurora.v1.gold.candidate.committed" || p.championInference == nil {
		return
	}
	var committed struct {
		SnapshotID string `json:"snapshot_id"`
	}
	if err := json.Unmarshal(msg.Data, &committed); err != nil || committed.SnapshotID == "" {
		p.log.Warn("Gold commit cannot trigger champion inference", "error", err)
		return
	}
	dispatched, err := p.championInference.EnsureChampionCoverage(ctx, committed.SnapshotID)
	if err != nil {
		p.log.Error("Champion inference planning failed for committed Gold snapshot", "snapshot_id", committed.SnapshotID, "error", err)
		return
	}
	if dispatched > 0 {
		p.log.Info("Champion inference dispatched for committed Gold snapshot", "snapshot_id", committed.SnapshotID, "jobs", dispatched)
	}
}

func (p *NATSPubSub) handleInferenceEvent(_ context.Context, msg *nats.Msg, jobID string) {
	p.log.Info("Inference event received", "subject", msg.Subject, "job_id", jobID)
}

func (p *NATSPubSub) handleMLEvent(_ context.Context, msg *nats.Msg, jobID string) {
	p.log.Info("ML training event received", "subject", msg.Subject, "job_id", jobID)
	if msg.Subject != "aurora.live.ml.promotion.progress" || p.championInference == nil {
		return
	}
	var promotion struct {
		Status string `json:"status"`
		Phase  string `json:"phase"`
	}
	if json.Unmarshal(msg.Data, &promotion) == nil && promotion.Status == "completed" && promotion.Phase == "completed" {
		go p.reconcileChampionInference()
	}
}

func (p *NATSPubSub) reconcileChampionInference() {
	if p.championInference == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dispatched, err := p.championInference.ReconcileChampionCoverage(ctx)
	if err != nil {
		p.log.Error("Champion inference reconciliation completed with errors", "dispatched_jobs", dispatched, "error", err)
		return
	}
	if dispatched > 0 {
		p.log.Info("Champion inference reconciliation dispatched missing jobs", "jobs", dispatched)
	}
}

func (p *NATSPubSub) handlePreprocessingEvent(_ context.Context, msg *nats.Msg) {
	if msg.Subject == "aurora.v1.preprocessing.runtime" && p.dagAggregation != nil {
		var runtime entity.PreprocessingRuntimeEvent
		if err := json.Unmarshal(msg.Data, &runtime); err != nil {
			p.log.Warn("Invalid preprocessing runtime event", "error", err)
			return
		}
		runtime.WorkerID = strings.TrimSpace(runtime.WorkerID)
		if runtime.WorkerID == "" {
			return
		}
		runtime.TicketID = strings.TrimSpace(runtime.TicketID)
		runtime.ProductKind = strings.TrimSpace(runtime.ProductKind)
		runtime.ObjectKey = strings.TrimSpace(runtime.ObjectKey)
		runtime.Stage = strings.TrimSpace(runtime.Stage)
		if runtime.OccurredAt.IsZero() {
			runtime.OccurredAt = time.Now().UTC()
		}
		p.dagAggregation.ObserveRuntime(runtime)
		return
	}
	p.log.Debug("Preprocessing control event received", "subject", msg.Subject)
}
