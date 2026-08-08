# Build Stage
FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /app/aurora-api ./cmd/aurora-api

# Runtime Stage
FROM alpine:3.22
RUN apk --no-cache add ca-certificates
RUN addgroup -S aurora && adduser -S -G aurora aurora
WORKDIR /app
COPY --from=builder /app/aurora-api .
USER aurora
EXPOSE 8080
ENTRYPOINT ["./aurora-api"]
