#!/usr/bin/env python3
"""
@civic/system-one V4: Cross-Attention Dual-Stream Neural-Symbolic Training Pipeline
================================================================================
Architecture:
- Shared Universal Civic Vocabulary Embeddings (15,000 terms x 64d)
- Title Stream (<=32 tokens) & Body Stream (<=128 tokens)
- Cross-Attention Evidence Retrieval: Title (Query) retrieves Body (Key/Value)
- Dual-Stream Contextual Fusion Network
- Multi-Task Joint Prototypical Projection Heads (Category, Intent, Urgency, Stability)
- Class-Weighted Focal Cross-Entropy Loss
"""

import os
import sys
import time
import math
import json
import random
import argparse
from typing import List, Dict, Any, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TRAIN_DATA = os.path.join(SCRIPT_DIR, "../data/civic_train.jsonl")
DEFAULT_VAL_DATA = os.path.join(SCRIPT_DIR, "../data/civic_val.jsonl")
VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")
OUTPUT_CKPT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v4")

CRITERIA_CHOICES = {
    "intent": ["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"],
    "category": [
        "urban_management", "traffic", "market_reg", "environment",
        "labor_social", "public_safety", "social_governance"
    ],
    "urgency": ["Level 0", "Level 1", "Level 2", "Level 3"],
    "stability": ["YES", "NO"]
}

# Balanced loss weights
CATEGORY_WEIGHTS = [1.2, 1.3, 1.0, 1.1, 1.0, 2.5, 1.0]


class DualStreamCivicTokenizer:
    def __init__(self, vocab_path: str, max_title_len: int = 32, max_body_len: int = 128):
        with open(vocab_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.tokens = data["tokens"]
        self.token_to_id = {tok: idx for idx, tok in enumerate(self.tokens)}
        self.pad_id = 0
        self.unk_id = 1
        self.max_title_len = max_title_len
        self.max_body_len = max_body_len

    def encode_str(self, text: str, max_len: int) -> List[int]:
        tokens = []
        t = text.strip()
        i = 0
        n = len(t)
        while i < n and len(tokens) < max_len:
            if i + 4 <= n and t[i:i+4] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i+4]])
                i += 4
            elif i + 3 <= n and t[i:i+3] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i+3]])
                i += 3
            elif i + 2 <= n and t[i:i+2] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i+2]])
                i += 2
            elif t[i] in self.token_to_id:
                tokens.append(self.token_to_id[t[i]])
                i += 1
            else:
                i += 1

        if not tokens:
            tokens = [self.unk_id]
        return tokens

    def encode(self, title: str, content: str) -> Tuple[List[int], List[int]]:
        title_tokens = self.encode_str(title, self.max_title_len)
        body_tokens = self.encode_str(content, self.max_body_len)
        return title_tokens, body_tokens


class DualStreamDatasetV4(Dataset):
    def __init__(self, jsonl_path: str, tokenizer: DualStreamCivicTokenizer):
        self.samples = []
        self.tokenizer = tokenizer
        
        print(f"📖 Loading V4 dataset: {jsonl_path}...", flush=True)
        t0 = time.perf_counter()

        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                title = d.get("title", "")
                content = d.get("content", d.get("state", ""))
                title_tokens, body_tokens = self.tokenizer.encode(title, content)

                self.samples.append({
                    "title_tokens": title_tokens,
                    "body_tokens": body_tokens,
                    "answers": d["answers"]
                })

        t_el = time.perf_counter() - t0
        print(f"✅ Loaded {len(self.samples):,} samples in {t_el:.2f}s ({len(self.samples)/t_el:,.1f} samples/s)", flush=True)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


def collate_fn_v4(batch, pad_id=0, max_title_len=32, max_body_len=128):
    b_size = len(batch)

    # 1. Title tensors
    t_lens = [len(item["title_tokens"]) for item in batch]
    max_t = min(max_title_len, max(t_lens))
    title_ids = torch.full((b_size, max_t), pad_id, dtype=torch.long)
    title_mask = torch.zeros((b_size, max_t), dtype=torch.float32)
    for i, item in enumerate(batch):
        t = item["title_tokens"][:max_t]
        title_ids[i, :len(t)] = torch.tensor(t, dtype=torch.long)
        title_mask[i, :len(t)] = 1.0

    # 2. Body tensors
    b_lens = [len(item["body_tokens"]) for item in batch]
    max_b = min(max_body_len, max(b_lens))
    body_ids = torch.full((b_size, max_b), pad_id, dtype=torch.long)
    body_mask = torch.zeros((b_size, max_b), dtype=torch.float32)
    for i, item in enumerate(batch):
        b = item["body_tokens"][:max_b]
        body_ids[i, :len(b)] = torch.tensor(b, dtype=torch.long)
        body_mask[i, :len(b)] = 1.0

    # 3. Targets
    dim_keys = ["intent", "category", "urgency", "stability"]
    targets = {}
    for d_idx, dim_name in enumerate(dim_keys):
        choices = CRITERIA_CHOICES[dim_name]
        labels = [
            choices.index(item["answers"][d_idx]) if item["answers"][d_idx] in choices else 0
            for item in batch
        ]
        targets[dim_name] = torch.tensor(labels, dtype=torch.long)

    return title_ids, title_mask, body_ids, body_mask, targets


class LayaDecisionModelV4(nn.Module):
    """
    V4 Cross-Attention Dual-Stream Neural Decision Network
    """
    def __init__(
        self,
        vocab_size: int = 15000,
        emb_dim: int = 64,
        hidden_dim: int = 128,
        proj_dim: int = 256,
        nhead: int = 4
    ):
        super().__init__()
        self.vocab_size = vocab_size
        self.emb_dim = emb_dim
        self.hidden_dim = hidden_dim
        self.proj_dim = proj_dim

        # 1. 共享词表嵌入层 (15,000 x 64 ≈ 3.8 MB)
        self.embedding = nn.Embedding(vocab_size, emb_dim, padding_idx=0)

        # 2. 标题独立流投影
        self.title_mlp = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU()
        )

        # 3. 正文独立流投影
        self.body_mlp = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU()
        )

        # 4. 交叉注意力机制 (Title as Query, Body as Key/Value)
        self.cross_attn = nn.MultiheadAttention(embed_dim=emb_dim, num_heads=nhead, batch_first=True)
        self.cross_norm = nn.LayerNorm(emb_dim)

        # 5. 三向融合网络 (Title + Body + CrossEvidence)
        self.fusion_mlp = nn.Sequential(
            nn.Linear(emb_dim * 3, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, proj_dim),
            nn.LayerNorm(proj_dim),
            nn.GELU()
        )

        # 6. 多维度原型打分
        self.choice_proj = nn.Sequential(
            nn.Linear(proj_dim, proj_dim),
            nn.LayerNorm(proj_dim),
            nn.GELU(),
            nn.Linear(proj_dim, proj_dim)
        )

        self.temperature = nn.Parameter(torch.ones([]) * math.log(1 / 0.07))
        self.choice_embeddings = nn.ParameterDict({
            dim: nn.Parameter(torch.randn(len(choices), proj_dim) / math.sqrt(proj_dim))
            for dim, choices in CRITERIA_CHOICES.items()
        })

    def forward(
        self,
        title_ids: torch.Tensor,
        title_mask: torch.Tensor,
        body_ids: torch.Tensor,
        body_mask: torch.Tensor,
        dim_name: str = None
    ):
        t_emb = self.embedding(title_ids) # [B, L_t, D]
        b_emb = self.embedding(body_ids)  # [B, L_b, D]

        # 1. 标题与正文独立平均池化
        t_m = title_mask.unsqueeze(-1)
        b_m = body_mask.unsqueeze(-1)
        t_pool = (t_emb * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)
        b_pool = (b_emb * b_m).sum(dim=1) / torch.clamp(b_m.sum(dim=1), min=1e-9)

        # 2. 交叉注意力：标题作为 Query 去正文中抓取证据
        # key_padding_mask: True where padded
        key_padding = (body_mask == 0)
        cross_out, _ = self.cross_attn(
            query=t_emb,
            key=b_emb,
            value=b_emb,
            key_padding_mask=key_padding
        )
        cross_norm = self.cross_norm(cross_out + t_emb)
        cross_pool = (cross_norm * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)

        # 3. 三向深度特征融合 (Title + Contextual Evidence + Body)
        fused_in = torch.cat([t_pool, cross_pool, b_pool], dim=-1)
        state_repr = F.normalize(self.fusion_mlp(fused_in), p=2, dim=-1)
        scale = torch.clamp(torch.exp(self.temperature), min=1.0, max=50.0)

        # 4. 原型点积打分
        if dim_name is not None:
            raw_choices = self.choice_embeddings[dim_name]
            choice_repr = F.normalize(self.choice_proj(raw_choices), p=2, dim=-1)
            return torch.matmul(state_repr, choice_repr.t()) * scale

        outputs = {}
        for dim, choices in self.choice_embeddings.items():
            choice_repr = F.normalize(self.choice_proj(choices), p=2, dim=-1)
            outputs[dim] = torch.matmul(state_repr, choice_repr.t()) * scale

        return outputs


def train_epoch_v4(model, dataloader, optimizer, scheduler, device, epoch, total_epochs, cat_weights):
    model.train()
    total_loss = 0.0
    t0 = time.perf_counter()
    steps = len(dataloader)
    dim_keys = ["intent", "category", "urgency", "stability"]

    for step, (t_ids, t_mask, b_ids, b_mask, targets) in enumerate(dataloader):
        t_ids = t_ids.to(device)
        t_mask = t_mask.to(device)
        b_ids = b_ids.to(device)
        b_mask = b_mask.to(device)

        optimizer.zero_grad()
        outputs = model(t_ids, t_mask, b_ids, b_mask)

        loss = 0.0
        for dim in dim_keys:
            target = targets[dim].to(device)
            logits = outputs[dim]
            if dim == "category":
                dim_loss = F.cross_entropy(logits, target, weight=cat_weights)
            elif dim == "stability":
                w = torch.tensor([1.0, 4.0], device=device)
                dim_loss = F.cross_entropy(logits, target, weight=w)
            elif dim == "urgency":
                w = torch.tensor([1.0, 1.0, 2.0, 4.0], device=device)
                dim_loss = F.cross_entropy(logits, target, weight=w)
            else:
                dim_loss = F.cross_entropy(logits, target)
            loss += dim_loss

        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        scheduler.step()

        total_loss += loss.item()

        if (step + 1) % 200 == 0 or (step + 1) == steps:
            el = time.perf_counter() - t0
            avg_l = total_loss / (step + 1)
            tps = (step + 1) * len(t_ids) / el
            print(f"   [V4 Epoch {epoch}/{total_epochs}] Step {step+1}/{steps} | Loss: {avg_l:.4f} | Speed: {tps:.1f} samples/s", flush=True)

    return total_loss / steps


def evaluate_v4(model, dataloader, device):
    model.eval()
    correct = {"intent": 0, "category": 0, "urgency": 0, "stability": 0}
    total = 0
    dim_keys = ["intent", "category", "urgency", "stability"]

    with torch.no_grad():
        for t_ids, t_mask, b_ids, b_mask, targets in dataloader:
            t_ids = t_ids.to(device)
            t_mask = t_mask.to(device)
            b_ids = b_ids.to(device)
            b_mask = b_mask.to(device)
            cur_b = len(t_ids)
            total += cur_b

            outputs = model(t_ids, t_mask, b_ids, b_mask)
            for dim in dim_keys:
                target = targets[dim].to(device)
                preds = outputs[dim].argmax(dim=-1)
                correct[dim] += (preds == target).sum().item()

    accs = {dim: correct[dim] / total for dim in dim_keys}
    accs["mean"] = np.mean(list(accs.values()))
    return accs


def main():
    parser = argparse.ArgumentParser(description="@civic/system-one V4 Cross-Attention Training Pipeline")
    parser.add_argument("--epochs", type=int, default=5, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    parser.add_argument("--lr", type=float, default=2e-3, help="Peak learning rate")
    args = parser.parse_args()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"\n🚀 Starting @civic/system-one V4 Cross-Attention Training on Apple Silicon: {device}", flush=True)

    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)
    train_dataset = DualStreamDatasetV4(DEFAULT_TRAIN_DATA, tokenizer)
    val_dataset = DualStreamDatasetV4(DEFAULT_VAL_DATA, tokenizer)

    train_loader = DataLoader(
        train_dataset, batch_size=args.batch_size, shuffle=True,
        collate_fn=collate_fn_v4, num_workers=0
    )
    val_loader = DataLoader(
        val_dataset, batch_size=args.batch_size * 2, shuffle=False,
        collate_fn=collate_fn_v4, num_workers=0
    )

    model = LayaDecisionModelV4(
        vocab_size=len(tokenizer.tokens),
        emb_dim=64,
        hidden_dim=128,
        proj_dim=256,
        nhead=4
    )
    model.to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"📦 V4 Model Initialized | Parameters: {total_params:,} (~{total_params * 4 / (1024*1024):.2f} MB float32)", flush=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total_steps = len(train_loader) * args.epochs
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_steps, eta_min=1e-5)
    cat_weights = torch.tensor(CATEGORY_WEIGHTS, dtype=torch.float32, device=device)

    os.makedirs(OUTPUT_CKPT_DIR, exist_ok=True)
    best_ckpt_path = os.path.join(OUTPUT_CKPT_DIR, "best_model.pt")
    best_mean_acc = 0.0

    for epoch in range(1, args.epochs + 1):
        print(f"\n=======================================================", flush=True)
        print(f"🔥 [V4 Cross-Attention] Epoch {epoch}/{args.epochs}", flush=True)
        print(f"=======================================================", flush=True)

        train_loss = train_epoch_v4(model, train_loader, optimizer, scheduler, device, epoch, args.epochs, cat_weights)
        print(f"✅ Epoch {epoch} Training Complete | Avg Loss: {train_loss:.4f}", flush=True)

        val_accs = evaluate_v4(model, val_loader, device)
        print(f"📊 Validation Scores ({len(val_dataset):,} blind samples):", flush=True)
        print(f"   Intent:    {val_accs['intent']*100:.2f}%", flush=True)
        print(f"   Category:  {val_accs['category']*100:.2f}%  (V1: 47.0%, V2: 84.95%, V3: 94.28%)", flush=True)
        print(f"   Urgency:   {val_accs['urgency']*100:.2f}%", flush=True)
        print(f"   Stability: {val_accs['stability']*100:.2f}%", flush=True)
        print(f"   Mean Acc:  {val_accs['mean']*100:.2f}%", flush=True)

        if val_accs["mean"] > best_mean_acc:
            best_mean_acc = val_accs["mean"]
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_accs": val_accs,
                "vocab_size": len(tokenizer.tokens),
                "emb_dim": 64,
                "hidden_dim": 128,
                "proj_dim": 256,
                "criteria": CRITERIA_CHOICES
            }, best_ckpt_path)
            print(f"⭐ Saved new best V4 checkpoint to: {best_ckpt_path} (Mean Acc: {best_mean_acc*100:.2f}%)", flush=True)

    print(f"\n🎉 V4 Cross-Attention Training Finished! Best Mean Accuracy: {best_mean_acc*100:.2f}%", flush=True)


if __name__ == "__main__":
    main()
