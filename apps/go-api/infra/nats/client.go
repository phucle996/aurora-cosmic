package nats

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Client quản lý kết nối và các thao tác giao tiếp NATS cơ bản (Core NATS & JetStream)
type Client struct {
	URL string

	mu sync.Mutex
	nc *nats.Conn
	js nats.JetStreamContext

	// RequestFunc optionally intercepts Request calls (useful for testing)
	RequestFunc func(ctx context.Context, subject string, payload []byte) ([]byte, error)
	// PublishFunc optionally intercepts Publish calls (useful for testing)
	PublishFunc func(ctx context.Context, subject string, payload []byte) error
	// PublishMsgFunc optionally intercepts PublishDurable calls (useful for testing)
	PublishMsgFunc func(ctx context.Context, msg *nats.Msg) (*nats.PubAck, error)
	// JetStreamFunc optionally intercepts JetStream calls (useful for testing)
	JetStreamFunc func(ctx context.Context) (nats.JetStreamContext, error)
}

// NewClient khởi tạo Client với URL của NATS cluster
func NewClient(url string) *Client {
	return &Client{URL: url}
}

// Conn trả về kết nối NATS Core (kết nối lazily nếu chưa khởi tạo)
func (c *Client) Conn(ctx context.Context) (*nats.Conn, error) {
	if c == nil || c.URL == "" {
		return nil, fmt.Errorf("NATS endpoint is unavailable")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.nc != nil && c.nc.IsConnected() {
		return c.nc, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	nc, err := nats.Connect(c.URL, nats.Timeout(5*time.Second))
	if err != nil {
		return nil, fmt.Errorf("connect NATS %s: %w", c.URL, err)
	}
	c.nc = nc
	return nc, nil
}

// JetStream trả về context JetStream (khởi tạo lazily nếu chưa có)
func (c *Client) JetStream(ctx context.Context) (nats.JetStreamContext, error) {
	if c != nil && c.JetStreamFunc != nil {
		return c.JetStreamFunc(ctx)
	}
	if c == nil || c.URL == "" {
		return nil, fmt.Errorf("NATS endpoint is unavailable")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.nc != nil && c.nc.IsConnected() && c.js != nil {
		return c.js, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	nc := c.nc
	if nc == nil || !nc.IsConnected() {
		var err error
		nc, err = nats.Connect(c.URL, nats.Timeout(5*time.Second))
		if err != nil {
			return nil, fmt.Errorf("connect NATS %s: %w", c.URL, err)
		}
		c.nc = nc
	}
	js, err := nc.JetStream()
	if err != nil {
		return nil, fmt.Errorf("create JetStream context: %w", err)
	}
	c.js = js
	return js, nil
}

// Publish gửi message tới subject Core NATS
func (c *Client) Publish(ctx context.Context, subject string, payload []byte) error {
	if c != nil && c.PublishFunc != nil {
		return c.PublishFunc(ctx, subject, payload)
	}
	nc, err := c.Conn(ctx)
	if err != nil {
		return err
	}
	return nc.Publish(subject, payload)
}

// Request gửi message và chờ response qua NATS Request-Reply
func (c *Client) Request(ctx context.Context, subject string, payload []byte) ([]byte, error) {
	if c != nil && c.RequestFunc != nil {
		return c.RequestFunc(ctx, subject, payload)
	}
	nc, err := c.Conn(ctx)
	if err != nil {
		return nil, err
	}
	msg, err := nc.RequestWithContext(ctx, subject, payload)
	if err != nil {
		return nil, err
	}
	return msg.Data, nil
}

// PublishDurable gửi message bền vững qua NATS JetStream
func (c *Client) PublishDurable(ctx context.Context, msg *nats.Msg) error {
	if c != nil && c.PublishMsgFunc != nil {
		_, err := c.PublishMsgFunc(ctx, msg)
		return err
	}
	js, err := c.JetStream(ctx)
	if err != nil {
		return err
	}
	if _, err := js.PublishMsg(msg); err != nil {
		return err
	}
	return c.Ping(ctx)
}

// Ping kiểm tra kết nối NATS
func (c *Client) Ping(ctx context.Context) error {
	nc, err := c.Conn(ctx)
	if err != nil {
		return err
	}
	flushCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return nc.FlushWithContext(flushCtx)
}

// Close đóng kết nối NATS
func (c *Client) Close() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.nc != nil {
		c.nc.Drain()
		c.nc.Close()
		c.nc, c.js = nil, nil
	}
	return nil
}
