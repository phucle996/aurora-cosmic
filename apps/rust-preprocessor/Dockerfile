# Build Stage
FROM rust:alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

# Runtime Stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/target/release/aurora-preprocessor .
ENTRYPOINT ["./aurora-preprocessor"]
