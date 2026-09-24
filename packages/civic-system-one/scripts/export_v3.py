#!/usr/bin/env python3
"""
@civic/system-one: Export V3 Model to ONNX and Apple MLX
======================================================
Exports trained V3 Dual-Stream Mini-Transformer Decision Model to ONNX (Opset 17)
and Apple Silicon Native MLX.
"""

import os
import sys
import json
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import onnxruntime as ort

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train_laya_v3 import LayaDecisionModelV3, DualStreamCivicTokenizer

CKPT_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v3/best_model.pt")
ONNX_OUTPUT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx")
MLX_OUTPUT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-mlx")
VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")


class FullDecisionWrapperV3(nn.Module):
    def __init__(self, core: LayaDecisionModelV3):
        super().__init__()
        self.core = core

    def forward(
        self,
        title_ids: torch.Tensor,
        title_mask: torch.Tensor,
        body_ids: torch.Tensor,
        body_mask: torch.Tensor
    ):
        # A. 标题流独立计算
        t_emb = self.core.embedding(title_ids)
        t_m = title_mask.unsqueeze(-1)
        t_pool = (t_emb * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)
        t_repr = F.normalize(self.core.title_proj(t_pool), p=2, dim=-1)

        # B. 正文细节流微型 Transformer 计算
        b_emb = self.core.embedding(body_ids)
        b_tf = self.core.body_transformer(b_emb)
        b_m = body_mask.unsqueeze(-1)
        b_pool = (b_tf * b_m).sum(dim=1) / torch.clamp(b_m.sum(dim=1), min=1e-9)
        b_repr = F.normalize(self.core.body_proj(b_pool), p=2, dim=-1)

        # C. 门控自适应融合
        gate = torch.sigmoid(self.core.gate_linear(torch.cat([t_repr, b_repr], dim=-1)))
        fused = gate * t_repr + (1.0 - gate) * b_repr

        # D. 状态投影归一化
        state_repr = F.normalize(self.core.state_proj(fused), p=2, dim=-1)
        scale = torch.clamp(torch.exp(self.core.temperature), min=1.0, max=50.0)

        # E. 多维度候选准则打分
        results = []
        for dim in ["intent", "category", "urgency", "stability"]:
            raw_choices = self.core.choice_embeddings[dim]
            choice_repr = F.normalize(self.core.choice_proj(raw_choices), p=2, dim=-1)
            results.append(torch.matmul(state_repr, choice_repr.t()) * scale)

        return results[0], results[1], results[2], results[3]


def export_models():
    if not os.path.exists(CKPT_PATH):
        print(f"❌ Checkpoint not found at: {CKPT_PATH}")
        sys.exit(1)

    print(f"📦 Loading V3 Checkpoint from: {CKPT_PATH}...")
    ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=False)

    vocab_size = ckpt.get("vocab_size", 15000)
    emb_dim = ckpt.get("emb_dim", 64)
    hidden_dim = ckpt.get("hidden_dim", 128)
    proj_dim = ckpt.get("proj_dim", 256)

    model = LayaDecisionModelV3(
        vocab_size=vocab_size,
        emb_dim=emb_dim,
        hidden_dim=hidden_dim,
        proj_dim=proj_dim,
        num_tf_layers=2
    )
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    wrapper = FullDecisionWrapperV3(model)
    wrapper.eval()

    # 1. Export to ONNX
    os.makedirs(ONNX_OUTPUT_DIR, exist_ok=True)
    onnx_path = os.path.join(ONNX_OUTPUT_DIR, "model_v3.onnx")

    dummy_t_ids = torch.randint(0, vocab_size, (1, 32), dtype=torch.long)
    dummy_t_mask = torch.ones((1, 32), dtype=torch.float32)
    dummy_b_ids = torch.randint(0, vocab_size, (1, 128), dtype=torch.long)
    dummy_b_mask = torch.ones((1, 128), dtype=torch.float32)

    print(f"⚡ Exporting to ONNX: {onnx_path} (Opset 17)...")
    torch.onnx.export(
        wrapper,
        (dummy_t_ids, dummy_t_mask, dummy_b_ids, dummy_b_mask),
        onnx_path,
        input_names=["title_ids", "title_mask", "body_ids", "body_mask"],
        output_names=["intent_logits", "category_logits", "urgency_logits", "stability_logits"],
        dynamic_axes={
            "title_ids": {0: "batch_size", 1: "title_seq_len"},
            "title_mask": {0: "batch_size", 1: "title_seq_len"},
            "body_ids": {0: "batch_size", 1: "body_seq_len"},
            "body_mask": {0: "batch_size", 1: "body_seq_len"},
            "intent_logits": {0: "batch_size"},
            "category_logits": {0: "batch_size"},
            "urgency_logits": {0: "batch_size"},
            "stability_logits": {0: "batch_size"}
        },
        opset_version=17,
        do_constant_folding=True
    )

    onnx_size = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"✅ ONNX V3 Exported successfully! File size: {onnx_size:.2f} MB")

    # Verify ONNX Runtime
    print("🔍 Testing ONNX Runtime inference...")
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    outs = sess.run(None, {
        "title_ids": np.ones((2, 32), dtype=np.int64),
        "title_mask": np.ones((2, 32), dtype=np.float32),
        "body_ids": np.ones((2, 128), dtype=np.int64),
        "body_mask": np.ones((2, 128), dtype=np.float32)
    })
    print(f"✅ ONNX Verification passed! Output shapes: {[o.shape for o in outs]}")

    # 2. Export to MLX
    os.makedirs(MLX_OUTPUT_DIR, exist_ok=True)
    mlx_weights_path = os.path.join(MLX_OUTPUT_DIR, "weights_v3.npz")
    mlx_config_path = os.path.join(MLX_OUTPUT_DIR, "config_v3.json")

    weights = {k: v.numpy() for k, v in model.state_dict().items()}
    np.savez(mlx_weights_path, **weights)

    config = {
        "version": "v3",
        "architecture": "LayaDecisionModelV3",
        "vocab_size": vocab_size,
        "emb_dim": emb_dim,
        "hidden_dim": hidden_dim,
        "proj_dim": proj_dim,
        "num_tf_layers": 2,
        "val_accs": ckpt["val_accs"],
        "mean_acc": ckpt["val_accs"]["mean"],
        "criteria": ckpt["criteria"]
    }
    with open(mlx_config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    mlx_size = os.path.getsize(mlx_weights_path) / (1024 * 1024)
    print(f"✅ MLX Weights saved to: {mlx_weights_path} ({mlx_size:.2f} MB)")
    print(f"📄 MLX Config saved to: {mlx_config_path}")


if __name__ == "__main__":
    export_models()
