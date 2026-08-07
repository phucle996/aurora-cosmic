# Build Stage
FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/aurora-ingester ./cmd/aurora-ingester

# Runtime Stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/aurora-ingester .
ENTRYPOINT ["./aurora-ingester"]
