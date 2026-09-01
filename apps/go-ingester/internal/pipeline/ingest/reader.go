package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
	"time"
)

const transferProgressInterval = 250 * time.Millisecond

type hashedReader struct {
	source         io.Reader
	hash           hash.Hash
	bytes          int64
	progress       func(int64)
	lastProgressAt time.Time
}

func newHashedReader(source io.Reader, progress ...func(int64)) *hashedReader {
	r := &hashedReader{source: source, hash: sha256.New(), lastProgressAt: time.Now()}
	if len(progress) > 0 {
		r.progress = progress[0]
	}
	return r
}

func (r *hashedReader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	if n > 0 {
		_, _ = r.hash.Write(buffer[:n])
		r.bytes += int64(n)
		r.reportProgress(false)
	}
	return n, err
}

func (r *hashedReader) bytesRead() int64 { return r.bytes }

func (r *hashedReader) sumHex() string { return hex.EncodeToString(r.hash.Sum(nil)) }

func (r *hashedReader) reportProgress(force bool) {
	if r.progress == nil || (!force && time.Since(r.lastProgressAt) < transferProgressInterval) {
		return
	}
	r.progress(r.bytes)
	r.lastProgressAt = time.Now()
}
