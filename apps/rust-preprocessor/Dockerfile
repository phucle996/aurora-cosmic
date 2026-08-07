# Build Stage
FROM rust:1.89-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml ./
COPY src ./src
COPY pkg ./pkg
RUN cargo build --release

# Runtime Stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/target/release/aurora-preprocessor .
ENTRYPOINT ["./aurora-preprocessor"]
