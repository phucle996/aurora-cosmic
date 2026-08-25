"""Candidate Deep Residual MLP Model Definition (candidate-deep-resmlp-v1).

PyTorch Deep Residual Network with Squeeze-and-Excitation (SE) Feature Attention
and Layer Normalization for exoplanet-candidate vetting tabular features.
"""

from typing import Tuple

import torch
import torch.nn as nn

from aurora_ml.ml.datasets.splits import CANDIDATE_MODEL_INPUT_FEATURES

__all__ = [
    "CandidateTabularMLP",
    "CandidateTabularMlpV1",
    "CANDIDATE_MODEL_INPUT_FEATURES",
]


class ResidualDenseBlock(nn.Module):
    """Residual Dense Block with LayerNorm, GELU, and Dropout."""

    def __init__(
        self, in_dim: int, hidden_dim: int, out_dim: int, dropout_rate: float = 0.15
    ):
        super().__init__()
        self.block = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(p=dropout_rate),
            nn.Linear(hidden_dim, out_dim),
            nn.LayerNorm(out_dim),
        )
        self.act = nn.GELU()
        self.shortcut = (
            nn.Linear(in_dim, out_dim) if in_dim != out_dim else nn.Identity()
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.shortcut(x) + self.block(x))


class FeatureAttentionGate(nn.Module):
    """Squeeze-and-Excitation channel/feature attention mechanism."""

    def __init__(self, dim: int, reduction: int = 4):
        super().__init__()
        reduced_dim = max(8, dim // reduction)
        self.gate = nn.Sequential(
            nn.Linear(dim, reduced_dim),
            nn.GELU(),
            nn.Linear(reduced_dim, dim),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        weights = self.gate(x)
        return x * weights


class CandidateTabularMLP(nn.Module):
    """Candidate Deep Residual Network with Feature Attention (candidate-deep-resmlp-v1).

    Accepts (N, input_dim) float32 feature tensor and produces (N, 1) raw logit tensor.
    No internal Sigmoid is applied, ensuring full compatibility with BCEWithLogitsLoss.
    """

    def __init__(
        self,
        input_dim: int = 32,
        hidden_dims: Tuple[int, ...] = (128, 256, 128, 64),
        dropout_rate: float = 0.15,
        model_version: str = "candidate-deep-resmlp-v1",
    ):
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dims = hidden_dims
        self.dropout_rate = dropout_rate
        self.model_version = model_version

        # 1. Feature Projection Embedding Layer
        self.input_proj = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.LayerNorm(128),
            nn.GELU(),
        )

        # 2. Deep Residual Block 1 (Dimension Expansion & Feature Crossing)
        self.res_block1 = ResidualDenseBlock(128, 256, 128, dropout_rate=dropout_rate)

        # 3. Feature Attention Gating (Inter-feature dependency learning)
        self.attn_gate = FeatureAttentionGate(128, reduction=4)

        # 4. Deep Residual Block 2 (Feature Refinement)
        self.res_block2 = ResidualDenseBlock(128, 128, 64, dropout_rate=dropout_rate)

        # 5. Bottleneck & Classification Head
        self.head = nn.Sequential(
            nn.Linear(64, 32),
            nn.LayerNorm(32),
            nn.GELU(),
            nn.Dropout(p=dropout_rate * 0.5),
            nn.Linear(32, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: Tensor of shape (N, input_dim), dtype float32

        Returns:
            Tensor of shape (N, 1) raw logits, dtype float32
        """
        if x.dim() != 2 or x.shape[1] != self.input_dim:
            raise ValueError(
                f"INVALID_INPUT_SHAPE: Expected input shape (N, {self.input_dim}), got {tuple(x.shape)}"
            )

        h = self.input_proj(x)
        h = self.res_block1(h)
        h = self.attn_gate(h)
        h = self.res_block2(h)
        logits = self.head(h)
        return logits


CandidateTabularMlpV1 = CandidateTabularMLP
