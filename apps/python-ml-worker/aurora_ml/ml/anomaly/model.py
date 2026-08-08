"""Anomaly Tabular Autoencoder Model Architecture (anomaly-lightcurve-autoencoder-v1).

PyTorch Autoencoder for light-curve scalar features:
  Input (dim) -> Linear(32) -> ReLU -> Linear(8) -> ReLU -> Linear(32) -> ReLU -> Linear(dim) -> Output (dim)
"""

from typing import Tuple

import torch
import torch.nn as nn


class AnomalyLightcurveAutoencoder(nn.Module):
    """PyTorch Tabular Autoencoder for astronomical light-curve anomaly detection."""

    model_version: str = "anomaly-lightcurve-autoencoder-v1"
    score_definition_version: str = "reconstruction-mse-v1"

    def __init__(self, input_dim: int = 14, hidden_dims: Tuple[int, int] = (32, 8)):
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dims = hidden_dims

        h1, latent = hidden_dims

        # Encoder: input_dim -> 32 -> 8 (latent)
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, h1),
            nn.ReLU(),
            nn.Linear(h1, latent),
            nn.ReLU(),
        )

        # Decoder: 8 (latent) -> 32 -> input_dim
        self.decoder = nn.Sequential(
            nn.Linear(latent, h1),
            nn.ReLU(),
            nn.Linear(h1, input_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass: computes reconstruction tensor x_hat of shape (N, input_dim)."""
        latent = self.encoder(x)
        reconstructed = self.decoder(latent)
        return reconstructed

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Extract bottleneck latent representation of shape (N, 8)."""
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
