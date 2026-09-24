#!/usr/bin/env python3
"""
@civic/system-one: Export V2 Model to ONNX and Apple MLX
======================================================
Exports trained V2 criteria-conditioned decision model with 15k embedding table
to ONNX (Opset 17) and Apple Silicon Native MLX.
"""

import os
import sys
import json
import numpy as np
import torch
import torch.nn as nn
import onnxruntime as ort

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train_laya_v2 import LayaDecisionModelV2, FastCivicTokenizer

CKPT_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v2/best_model.pt")
ONNX_OUTPUT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx")
MLX_OUTPUT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-mlx")
VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")

class FullDecisionWrapperV2(nn.Module):
    def __init__(self, core):
        super().__init__()
        self.core = core

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor):
        intent_logits = self.core(input_ids, attention_mask, "intent")
        category_logits = self.core(input_ids, attention_mask, "category")
        urgency_logits = self.core(input_ids, attention_mask, "urgency")
        stability_logits = self.core(input_ids, attention_mask, "stability")
        return intent_logits, category_logits, urgency_logits, stability_logits

def export_models():
    print(f"📦 Loading V2 Checkpoint from: {CKPT_PATH}...")
    ckpt = torch.load(CKPT_PATH, map_location="cpu", weights_only=False)
    
    vocab_size = ckpt.get("vocab_size", 15000)
    emb_dim = ckpt.get("emb_dim", 64)
    proj_dim = ckpt.get("proj_dim", 256)
    
    model = LayaDecisionModelV2(vocab_size=vocab_size, emb_dim=emb_dim, proj_dim=proj_dim)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()

    wrapper = FullDecisionWrapperV2(model)
    wrapper.eval()

    # 1. Export to ONNX
    os.makedirs(ONNX_OUTPUT_DIR, exist_ok=True)
    onnx_path = os.path.join(ONNX_OUTPUT_DIR, "model_v2.onnx")
    
    dummy_input_ids = torch.randint(0, vocab_size, (1, 32), dtype=torch.long)
    dummy_mask = torch.ones((1, 32), dtype=torch.float32)

    print(f"⚡ Exporting to ONNX: {onnx_path} (Opset 17)...")
    torch.onnx.export(
        wrapper,
        (dummy_input_ids, dummy_mask),
        onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["intent_logits", "category_logits", "urgency_logits", "stability_logits"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "sequence_length"},
            "attention_mask": {0: "batch_size", 1: "sequence_length"},
            "intent_logits": {0: "batch_size"},
            "category_logits": {0: "batch_size"},
            "urgency_logits": {0: "batch_size"},
            "stability_logits": {0: "batch_size"}
        },
        opset_version=17,
        do_constant_folding=True
    )
    
    onnx_size = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"✅ ONNX Exported successfully! File size: {onnx_size:.2f} MB")

    # Verify ONNX Runtime
    print("🔍 Testing ONNX Runtime inference...")
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    outs = sess.run(None, {
        "input_ids": np.ones((2, 64), dtype=np.int64),
        "attention_mask": np.ones((2, 64), dtype=np.float32)
    })
    print(f"✅ ONNX Verification passed! Output shapes: {[o.shape for o in outs]}")

    # 2. Export to MLX
    os.makedirs(MLX_OUTPUT_DIR, exist_ok=True)
    mlx_weights_path = os.path.join(MLX_OUTPUT_DIR, "weights_v2.npz")
    mlx_config_path = os.path.join(MLX_OUTPUT_DIR, "config_v2.json")
    
    weights = {k: v.numpy() for k, v in model.state_dict().items()}
    np.savez(mlx_weights_path, **weights)
    
    config = {
        "version": "v2",
        "architecture": "LayaDecisionModelV2",
        "vocab_size": vocab_size,
        "emb_dim": emb_dim,
        "proj_dim": proj_dim,
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
