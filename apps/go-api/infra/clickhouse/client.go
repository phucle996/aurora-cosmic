package clickhouse

import (
	"context"
	"fmt"
	"time"

	clickhouse_driver "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

type Client struct {
	Conn driver.Conn
}

func NewClient(addr, database, username, password string) (*Client, error) {
	if addr == "" {
		addr = "127.0.0.1:9004"
	}
	if database == "" {
		database = "aurora"
	}
	conn, err := clickhouse_driver.Open(&clickhouse_driver.Options{
		Addr: []string{addr},
		Auth: clickhouse_driver.Auth{
			Database: database,
			Username: username,
			Password: password,
		},
		DialTimeout:     5 * time.Second,
		MaxOpenConns:    20,
		MaxIdleConns:    5,
		ConnMaxLifetime: 10 * time.Minute,
	})
	if err != nil {
		return nil, fmt.Errorf("open clickhouse connection: %w", err)
	}
	return &Client{Conn: conn}, nil
}

func NewClientWithConn(conn driver.Conn) *Client {
	return &Client{Conn: conn}
}

func (c *Client) Select(ctx context.Context, dest any, query string, args ...any) error {
	if c == nil || c.Conn == nil {
		return fmt.Errorf("clickhouse connection is unavailable")
	}
	return c.Conn.Select(ctx, dest, query, args...)
}

func (c *Client) Exec(ctx context.Context, query string, args ...any) error {
	if c == nil || c.Conn == nil {
		return fmt.Errorf("clickhouse connection is unavailable")
	}
	return c.Conn.Exec(ctx, query, args...)
}

func (c *Client) Query(ctx context.Context, query string, args ...any) (driver.Rows, error) {
	if c == nil || c.Conn == nil {
		return nil, fmt.Errorf("clickhouse connection is unavailable")
	}
	return c.Conn.Query(ctx, query, args...)
}

func (c *Client) QueryRow(ctx context.Context, query string, args ...any) driver.Row {
	if c == nil || c.Conn == nil {
		return nil
	}
	return c.Conn.QueryRow(ctx, query, args...)
}

func (c *Client) PrepareBatch(ctx context.Context, query string, opts ...driver.PrepareBatchOption) (driver.Batch, error) {
	if c == nil || c.Conn == nil {
		return nil, fmt.Errorf("clickhouse connection is unavailable")
	}
	return c.Conn.PrepareBatch(ctx, query, opts...)
}

func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.Conn == nil {
		return fmt.Errorf("clickhouse connection is unavailable")
	}
	return c.Conn.Ping(ctx)
}

func (c *Client) Close() error {
	if c == nil || c.Conn == nil {
		return nil
	}
	return c.Conn.Close()
}
