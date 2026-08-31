package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"hash"
	"io"
)

type hashedReader struct {
	source io.Reader
	hash   hash.Hash
	bytes  int64
}

func newHashedReader(source io.Reader) *hashedReader {
	return &hashedReader{source: source, hash: sha256.New()}
}

func (r *hashedReader) Read(buffer []byte) (int, error) {
	n, err := r.source.Read(buffer)
	if n > 0 {
		_, _ = r.hash.Write(buffer[:n])
		r.bytes += int64(n)
	}
	return n, err
}

func (r *hashedReader) bytesRead() int64 { return r.bytes }

func (r *hashedReader) sumHex() string { return hex.EncodeToString(r.hash.Sum(nil)) }
