# ONNX Runtime's prebuilt Linux binary targets glibc. Use Debian for both
# stages; Alpine/musl would compile the Rust binary but fail to load the ORT
# shared library at runtime.
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04 AS builder
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates pkg-config build-essential curl \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.97.1 \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.cargo/bin:${PATH}"
ENV CUDA_VERSION=13
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release
RUN find /root/.cache/ort.pyke.io -type f -name 'libonnxruntime*.so' -exec cp {} /app/ \;

FROM nvidia/cuda:13.0.2-runtime-ubuntu24.04
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
COPY --from=builder /app/target/release/aurora-inference .
COPY --from=builder /app/libonnxruntime*.so ./
ENTRYPOINT ["./aurora-inference"]
