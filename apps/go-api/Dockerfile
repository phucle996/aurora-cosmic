# Build Stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/aurora-api ./cmd/aurora-api

# Runtime Stage
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/aurora-api .
EXPOSE 8080
ENTRYPOINT ["./aurora-api"]
