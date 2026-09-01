package ingest

import (
	"bytes"
	"io"
	"testing"
)

func TestHashedReaderReportsTransferredBytes(t *testing.T) {
	payload := bytes.Repeat([]byte("fits"), 1024)
	var reported int64
	reader := newHashedReader(bytes.NewReader(payload), func(bytesRead int64) {
		reported = bytesRead
	})

	if _, err := io.Copy(io.Discard, reader); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	reader.reportProgress(true)

	if got, want := reported, int64(len(payload)); got != want {
		t.Fatalf("reported bytes = %d, want %d", got, want)
	}
	if got, want := reader.bytesRead(), int64(len(payload)); got != want {
		t.Fatalf("reader bytes = %d, want %d", got, want)
	}
}
