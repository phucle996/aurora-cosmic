"""Candidate Tabular MLP Model Definition (candidate-tabular-mlp-v1).

PyTorch MLP for exoplanet-candidate vetting tabular features.
"""

from typing import List, Tuple

import torch
import torch.nn as nn


class CandidateTabularMLP(nn.Module):
    """Candidate Tabular MLP Classifier (candidate-tabular-mlp-v1).

    Accepts (N, 32) float32 feature tensor and produces (N, 1) raw logit tensor.
    No internal Sigmoid is applied, ensuring full compatibility with BCEWithLogitsLoss.
    """

    def __init__(
        self,
        input_dim: int = 32,
        hidden_dims: Tuple[int, ...] = (64, 32),
        dropout_rate: float = 0.2,
        model_version: str = "candidate-tabular-mlp-v1",
    ):
        super().__init__()
        self.input_dim = input_dim
        self.hidden_dims = hidden_dims
        self.dropout_rate = dropout_rate
        self.model_version = model_version

        layers: List[nn.Module] = []
        curr_dim = input_dim

        for hdim in hidden_dims:
            layers.append(nn.Linear(curr_dim, hdim))
            layers.append(nn.BatchNorm1d(hdim))
            layers.append(nn.ReLU())
            if dropout_rate > 0.0:
                layers.append(nn.Dropout(p=dropout_rate))
            curr_dim = hdim

        # Final linear projection layer -> single logit output
        layers.append(nn.Linear(curr_dim, 1))

        self.net = nn.Sequential(*layers)

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

        # Batch normalization requires N > 1 in training mode; set to eval or handle single-sample gracefully
        if self.training and x.shape[0] == 1:
            self.eval()
            out = self.net(x)
            self.train()
            return out

        return self.net(x)
