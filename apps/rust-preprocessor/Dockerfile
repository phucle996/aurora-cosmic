# Build Stage
FROM rust:alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev cfitsio-dev pkgconfig
ENV RUSTFLAGS="-C target-feature=-crt-static"
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

# Runtime Stage
FROM alpine:latest
WORKDIR /app
RUN apk add --no-cache cfitsio
COPY --from=builder /app/target/release/aurora-preprocessor .
ENTRYPOINT ["./aurora-preprocessor"]
