package repository

import "testing"

type factoryHistoryDecodeProbe struct {
	PendingInputs    int64 `json:"pending_inputs"`
	CompletedBatches int64 `json:"completed_batches"`
	InputRecords     int64 `json:"input_records"`
}

func TestDecodeFactoryRowsAcceptsClickHouseQuotedInt64Metrics(t *testing.T) {
	rows, err := decodeFactoryRows[factoryHistoryDecodeProbe]([]byte(`{
		"data": [{
			"pending_inputs": "14645",
			"completed_batches": "5",
			"input_records": "1249"
		}]
	}`))
	if err != nil {
		t.Fatalf("decodeFactoryRows() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("decoded rows = %d, want 1", len(rows))
	}
	if rows[0].PendingInputs != 14645 || rows[0].CompletedBatches != 5 || rows[0].InputRecords != 1249 {
		t.Fatalf("decoded row = %+v, want numeric metrics", rows[0])
	}
}

func TestDecodeFactoryRowsKeepsNumericMetrics(t *testing.T) {
	rows, err := decodeFactoryRows[factoryHistoryDecodeProbe]([]byte(`{
		"data": [{
			"pending_inputs": 14645,
			"completed_batches": 5,
			"input_records": 1249
		}]
	}`))
	if err != nil {
		t.Fatalf("decodeFactoryRows() error = %v", err)
	}
	if rows[0].PendingInputs != 14645 || rows[0].CompletedBatches != 5 || rows[0].InputRecords != 1249 {
		t.Fatalf("decoded row = %+v, want numeric metrics", rows[0])
	}
}
