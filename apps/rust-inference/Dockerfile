# syntax=docker/dockerfile:1.7
# ONNX Runtime's prebuilt Linux binary targets glibc. Use Debian for both
# stages; Alpine/musl would compile the Rust binary but fail to load the ORT
# shared library at runtime.
# The deployment host exposes a CUDA 12.4-compatible driver.  NVIDIA provides
# that CUDA ABI for Ubuntu 22.04; it remains glibc-compatible with ONNX Runtime.
ARG CUDA_VERSION=12.4.1
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS builder
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates pkg-config build-essential curl \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.97.1 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
ENV CUDA_VERSION=12
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=cache,target=/root/.cache/ort.pyke.io \
    --mount=type=cache,target=/app/target \
    cargo build --locked --release \
    && install -D target/release/aurora-inference /out/aurora-inference \
    && find /root/.cache/ort.pyke.io -type f -name 'libonnxruntime*.so' -exec cp {} /out/ \;

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 curl \
    && rm -rf /var/lib/apt/lists/*
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
COPY --from=builder /out/aurora-inference .
COPY --from=builder /out/libonnxruntime*.so ./
ENTRYPOINT ["./aurora-inference"]
