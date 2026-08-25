"""Anomaly Deep Bottleneck Autoencoder Model Architecture (anomaly-deep-autoencoder-v1).

PyTorch Deep Residual Bottleneck Autoencoder with LayerNorm and GELU for astronomical
light-curve anomaly detection and rare transient phenomenon discovery.
"""

from typing import Tuple

import torch
import torch.nn as nn

from aurora_ml.ml.datasets.splits import ANOMALY_MODEL_INPUT_FEATURES

__all__ = [
    "ANOMALY_AUTOENCODER_HIDDEN_DIMS",
    "AnomalyLightcurveAutoencoder",
    "AnomalyAutoencoderV1",
    "ANOMALY_MODEL_INPUT_FEATURES",
    "compute_reconstruction_mse",
]


# This architecture is part of the anomaly runtime contract. Training,
# evaluation, and ONNX export must reconstruct the same module before loading a
# checkpoint.
ANOMALY_AUTOENCODER_HIDDEN_DIMS: Tuple[int, ...] = (32, 8)


class AnomalyLightcurveAutoencoder(nn.Module):
    """PyTorch Deep Tabular Autoencoder for astronomical light-curve anomaly detection."""

    model_version: str = "anomaly-deep-autoencoder-v1"
    score_definition_version: str = "reconstruction-mse-v1"

    def __init__(
        self,
        input_dim: int = 14,
        hidden_dims: Tuple[int, ...] = ANOMALY_AUTOENCODER_HIDDEN_DIMS,
    ):
        super().__init__()
        if not hidden_dims or any(width <= 0 for width in hidden_dims):
            raise ValueError("hidden_dims must contain at least one positive width")

        self.input_dim = input_dim
        self.hidden_dims = hidden_dims
        self.latent_dim = hidden_dims[-1]

        encoder_layers: list[nn.Module] = []
        previous_width = input_dim
        for index, width in enumerate(hidden_dims):
            encoder_layers.extend(
                (nn.Linear(previous_width, width), nn.LayerNorm(width))
            )
            if index < len(hidden_dims) - 1:
                encoder_layers.append(nn.GELU())
            previous_width = width
        self.encoder = nn.Sequential(*encoder_layers)

        decoder_layers: list[nn.Module] = []
        previous_width = self.latent_dim
        for width in reversed(hidden_dims[:-1]):
            decoder_layers.extend(
                (nn.Linear(previous_width, width), nn.LayerNorm(width), nn.GELU())
            )
            previous_width = width
        decoder_layers.append(nn.Linear(previous_width, input_dim))
        self.decoder = nn.Sequential(*decoder_layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass: computes reconstruction tensor x_hat of shape (N, input_dim)."""
        latent = self.encoder(x)
        reconstructed = self.decoder(latent)
        return reconstructed

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Extract bottleneck latent representation of shape (N, hidden_dims[-1])."""
        return self.encoder(x)


def compute_reconstruction_mse(x: torch.Tensor, x_hat: torch.Tensor) -> torch.Tensor:
    """Compute per-row Mean Squared Error (reconstruction-mse-v1) in standardized feature space.

    Args:
        x: Standardized input tensor (N, d)
        x_hat: Reconstructed tensor (N, d)

    Returns:
        1D tensor of per-row reconstruction MSE scores (N,)
    """
    diff_sq = (x - x_hat) ** 2
    per_row_mse = torch.mean(diff_sq, dim=1)
    return per_row_mse


AnomalyAutoencoderV1 = AnomalyLightcurveAutoencoder
