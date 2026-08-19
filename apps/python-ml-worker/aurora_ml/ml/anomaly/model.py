"""Anomaly Deep Bottleneck Autoencoder Model Architecture (anomaly-deep-autoencoder-v1).

PyTorch Deep Residual Bottleneck Autoencoder with LayerNorm and GELU for astronomical
light-curve anomaly detection and rare transient phenomenon discovery.
"""

from typing import Tuple

import torch
import torch.nn as nn

from aurora_ml.ml.datasets.splits import ANOMALY_MODEL_INPUT_FEATURES

__all__ = ["AnomalyLightcurveAutoencoder", "AnomalyAutoencoderV1", "ANOMALY_MODEL_INPUT_FEATURES", "compute_reconstruction_mse"]


class AnomalyLightcurveAutoencoder(nn.Module):
    """PyTorch Deep Tabular Autoencoder for astronomical light-curve anomaly detection."""

    model_version: str = "anomaly-deep-autoencoder-v1"
    score_definition_version: str = "reconstruction-mse-v1"

    def __init__(self, input_dim: int = 14, hidden_dims: Tuple[int, int, int] = (64, 32, 16)):
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dims = hidden_dims

        # Encoder: input_dim -> 64 -> 32 -> 16 (Deep compressed latent space)
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Linear(64, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Linear(32, 16),
            nn.LayerNorm(16),
        )

        # Decoder: 16 (latent) -> 32 -> 64 -> input_dim
        self.decoder = nn.Sequential(
            nn.Linear(16, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Linear(32, 64),
            nn.LayerNorm(64),
            nn.GELU(),
            nn.Linear(64, input_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass: computes reconstruction tensor x_hat of shape (N, input_dim)."""
        latent = self.encoder(x)
        reconstructed = self.decoder(latent)
        return reconstructed

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Extract bottleneck latent representation of shape (N, 16)."""
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
