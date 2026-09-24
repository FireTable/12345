#!/usr/bin/env python3
"""
@civic/system-one: V3 Ultimate Dual-Stream Mini-Transformer Architecture
=======================================================================
Major architectural upgrades:
1. Dual-Stream Independent Encoders:
   - Title Stream (high-density semantic essence)
   - Content Stream (2-layer Mini-Transformer context encoder, d_model=64, nhead=4)
2. Gated Fusion Layer: dynamic learned gating between title essence and body details.
3. Adversarial Hard-Negative Distractor Augmentation:
   - 10% samples randomly injected with address/traffic distractors to build immunity.
4. Class-Weighted Loss to boost public safety, market reg, and labor protection.
"""

import os
import sys
import time
import json
import math
import re
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
OUTPUT_CKPT_DIR = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v3")

CRITERIA_CHOICES = {
    "intent": ["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"],
    "category": ["urban_management", "traffic", "market_reg", "environment", "labor_social", "public_safety", "social_governance"],
    "urgency": ["Level 0", "Level 1", "Level 2", "Level 3"],
    "stability": ["YES", "NO"]
}

# Loss weights for category balance (public safety & market reg boosted)
CATEGORY_WEIGHTS = [1.0, 1.2, 1.5, 1.0, 1.0, 3.0, 0.8]

# Adversarial distractors for data augmentation
ADVERSARIAL_DISTRACTORS = [
    "，事发地位于大良街道居委会后街3号对面。",
    "，位于交警中队对面50米红绿灯路口处。",
    "，在派出所与街道综合服务中心中间商铺。",
    "，地址在镇政府政务大厅隔壁。",
    "，过红绿灯直走200米十字路口拐弯处。"
]


class DualStreamCivicTokenizer:
    def __init__(self, vocab_json_path: str, max_title_len: int = 32, max_body_len: int = 128):
        with open(vocab_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.tokens = data["tokens"]
        self.token_to_id = data["token_to_id"]
        self.max_title_len = max_title_len
        self.max_body_len = max_body_len
        self.pad_id = self.token_to_id.get("[PAD]", 0)
        self.unk_id = self.token_to_id.get("[UNK]", 1)

    def clean_text(self, text: str) -> str:
        t = re.sub(r"\{\{.*?\}\}", "", text)
        t = re.sub(r"广东省?佛山市?顺德区?[^\s，。,；;]+(街道|镇|村|社区|居委会|大厦|花园|路|街|巷|号|楼)", "", t)
        return t

    def encode_str(self, text: str, max_len: int) -> List[int]:
        t = self.clean_text(text)
        tokens = []
        i = 0
        n = min(len(t), max_len * 2)
        
        while i < n and len(tokens) < max_len:
            if i + 3 <= n and t[i:i+3] in self.token_to_id:
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


class DualStreamCivicDataset(Dataset):
    def __init__(self, jsonl_path: str, tokenizer: DualStreamCivicTokenizer, is_train: bool = True, max_samples: int = None):
        self.samples = []
        self.tokenizer = tokenizer
        
        print(f"📖 Loading V3 Dual-Stream dataset: {jsonl_path} (is_train={is_train})...")
        t0 = time.perf_counter()

        with open(jsonl_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                if max_samples and idx >= max_samples:
                    break
                line = line.strip()
                if not line:
                    continue
                d = json.loads(line)
                
                title = d.get("title", "")
                content = d.get("content", d.get("state", ""))
                
                # 训练阶段执行 10% 对抗难例注入 (逼迫模型摆脱地址依赖)
                if is_train and random.random() < 0.10:
                    distractor = random.choice(ADVERSARIAL_DISTRACTORS)
                    content = content + distractor

                title_tokens, body_tokens = self.tokenizer.encode(title, content)

                self.samples.append({
                    "title_tokens": title_tokens,
                    "body_tokens": body_tokens,
                    "answers": d["answers"]
                })

        t_el = time.perf_counter() - t0
        print(f"✅ Loaded {len(self.samples):,} samples in {t_el:.2f}s ({len(self.samples)/t_el:,.1f} samples/s)")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


def collate_fn_v3(batch, pad_id=0, max_title_len=32, max_body_len=128):
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


class LayaDecisionModelV3(nn.Module):
    """
    V3 Dual-Stream Mini-Transformer Criteria Decision Architecture
    """
    def __init__(
        self,
        vocab_size: int = 15000,
        emb_dim: int = 64,
        hidden_dim: int = 128,
        proj_dim: int = 256,
        num_tf_layers: int = 2
    ):
        super().__init__()
        self.vocab_size = vocab_size
        self.emb_dim = emb_dim
        self.hidden_dim = hidden_dim
        self.proj_dim = proj_dim

        # 共享统一政务词表嵌入层 (15,000 x 64 ≈ 3.8 MB)
        self.embedding = nn.Embedding(vocab_size, emb_dim, padding_idx=0)

        # 1. 标题独立流投影网络
        self.title_proj = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim)
        )

        # 2. 正文细节流微型自注意力网络 (2层 Mini-Transformer, ~153KB)
        tf_layer = nn.TransformerEncoderLayer(
            d_model=emb_dim,
            nhead=4,
            dim_feedforward=128,
            dropout=0.1,
            batch_first=True
        )
        self.body_transformer = nn.TransformerEncoder(tf_layer, num_layers=num_tf_layers)
        self.body_proj = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim)
        )

        # 3. 门控自适应融合层 (Gated Fusion)
        self.gate_linear = nn.Linear(hidden_dim * 2, 1)

        # 4. 融合状态跨准则投影
        self.state_proj = nn.Sequential(
            nn.Linear(hidden_dim, proj_dim),
            nn.LayerNorm(proj_dim),
            nn.GELU(),
            nn.Linear(proj_dim, proj_dim)
        )

        # 5. 准则条件原型投影
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
        # A. 标题流独立计算
        t_emb = self.embedding(title_ids)
        t_m = title_mask.unsqueeze(-1)
        t_pool = (t_emb * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)
        t_repr = F.normalize(self.title_proj(t_pool), p=2, dim=-1) # [B, hidden_dim]

        # B. 正文细节流微型 Transformer 计算
        b_emb = self.embedding(body_ids)
        b_tf = self.body_transformer(b_emb)
        b_m = body_mask.unsqueeze(-1)
        b_pool = (b_tf * b_m).sum(dim=1) / torch.clamp(b_m.sum(dim=1), min=1e-9)
        b_repr = F.normalize(self.body_proj(b_pool), p=2, dim=-1) # [B, hidden_dim]

        # C. 门控动态融合
        gate = torch.sigmoid(self.gate_linear(torch.cat([t_repr, b_repr], dim=-1))) # [B, 1]
        fused = gate * t_repr + (1.0 - gate) * b_repr # [B, hidden_dim]

        # D. 状态投影归一化
        state_repr = F.normalize(self.state_proj(fused), p=2, dim=-1) # [B, proj_dim]
        scale = torch.clamp(torch.exp(self.temperature), min=1.0, max=50.0)

        # E. 候选准则原型点积打分
        if dim_name is not None:
            raw_choices = self.choice_embeddings[dim_name]
            choice_repr = F.normalize(self.choice_proj(raw_choices), p=2, dim=-1)
            return torch.matmul(state_repr, choice_repr.t()) * scale

        logits_dict = {}
        for dim, raw_choices in self.choice_embeddings.items():
            choice_repr = F.normalize(self.choice_proj(raw_choices), p=2, dim=-1)
            logits_dict[dim] = torch.matmul(state_repr, choice_repr.t()) * scale
        return logits_dict


def train_epoch_v3(model, dataloader, optimizer, scheduler, device, epoch, total_epochs, cat_weights):
    model.train()
    total_loss = 0.0
    t0 = time.perf_counter()
    steps = len(dataloader)
    dim_keys = ["intent", "category", "urgency", "stability"]

    for step, (title_ids, title_mask, body_ids, body_mask, targets) in enumerate(dataloader):
        title_ids = title_ids.to(device)
        title_mask = title_mask.to(device)
        body_ids = body_ids.to(device)
        body_mask = body_mask.to(device)

        optimizer.zero_grad()
        logits_dict = model(title_ids, title_mask, body_ids, body_mask)

        loss = 0.0
        for dim_name in dim_keys:
            target = targets[dim_name].to(device)
            logits = logits_dict[dim_name]

            if dim_name == "category":
                dim_loss = F.cross_entropy(logits, target, weight=cat_weights)
            elif dim_name == "stability":
                weight = torch.tensor([1.0, 4.0], device=device)
                dim_loss = F.cross_entropy(logits, target, weight=weight)
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
            tps = (step + 1) * len(title_ids) / el
            print(f"   [Epoch {epoch}/{total_epochs}] Step {step+1}/{steps} | Loss: {avg_l:.4f} | Speed: {tps:.1f} samples/s", flush=True)

    return total_loss / steps


def evaluate_v3(model, dataloader, device):
    model.eval()
    correct = {"intent": 0, "category": 0, "urgency": 0, "stability": 0}
    total = 0
    dim_keys = ["intent", "category", "urgency", "stability"]

    with torch.no_grad():
        for title_ids, title_mask, body_ids, body_mask, targets in dataloader:
            title_ids = title_ids.to(device)
            title_mask = title_mask.to(device)
            body_ids = body_ids.to(device)
            body_mask = body_mask.to(device)
            b_size = len(title_ids)
            total += b_size

            logits_dict = model(title_ids, title_mask, body_ids, body_mask)
            for dim_name in dim_keys:
                target = targets[dim_name].to(device)
                preds = logits_dict[dim_name].argmax(dim=-1)
                correct[dim_name] += (preds == target).sum().item()

    accs = {dim: correct[dim] / total for dim in dim_keys}
    accs["mean"] = np.mean(list(accs.values()))
    return accs


def main():
    parser = argparse.ArgumentParser(description="@civic/system-one V3 Training Pipeline")
    parser.add_argument("--epochs", type=int, default=5, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size for training")
    parser.add_argument("--lr", type=float, default=2e-3, help="Peak learning rate")
    args = parser.parse_args()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"\n🚀 Starting @civic/system-one V3 Dual-Stream Training on Apple Silicon: {device}")

    # 1. Load Tokenizer & Datasets
    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)
    train_dataset = DualStreamCivicDataset(DEFAULT_TRAIN_DATA, tokenizer, is_train=True)
    val_dataset = DualStreamCivicDataset(DEFAULT_VAL_DATA, tokenizer, is_train=False)

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        collate_fn=collate_fn_v3
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size * 2,
        shuffle=False,
        collate_fn=collate_fn_v3
    )

    # 2. Init Model
    model = LayaDecisionModelV3(
        vocab_size=len(tokenizer.tokens),
        emb_dim=64,
        hidden_dim=128,
        proj_dim=256,
        num_tf_layers=2
    )
    model.to(device)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"📦 Model Initialized | Parameters: {total_params:,} (~{total_params * 4 / (1024*1024):.2f} MB float32)")

    # 3. Optimizer & Scheduler
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total_steps = len(train_loader) * args.epochs
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_steps, eta_min=1e-5)

    cat_weights = torch.tensor(CATEGORY_WEIGHTS, dtype=torch.float32, device=device)

    best_mean_acc = 0.0
    os.makedirs(OUTPUT_CKPT_DIR, exist_ok=True)
    best_ckpt_path = os.path.join(OUTPUT_CKPT_DIR, "best_model.pt")

    for epoch in range(1, args.epochs + 1):
        print(f"\n=======================================================", flush=True)
        print(f"🔥 [V3] Epoch {epoch}/{args.epochs}", flush=True)
        print(f"=======================================================", flush=True)

        train_loss = train_epoch_v3(model, train_loader, optimizer, scheduler, device, epoch, args.epochs, cat_weights)
        print(f"✅ Epoch {epoch} Training Complete | Avg Loss: {train_loss:.4f}", flush=True)

        # Evaluation
        val_accs = evaluate_v3(model, val_loader, device)
        print(f"📊 Validation Scores ({len(val_dataset):,} blind samples):", flush=True)
        print(f"   Intent:    {val_accs['intent']*100:.2f}%", flush=True)
        print(f"   Category:  {val_accs['category']*100:.2f}%  (V1: 47.0%, V2: 84.95%)", flush=True)
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
            print(f"⭐ Saved new best V3 checkpoint to: {best_ckpt_path} (Mean Acc: {best_mean_acc*100:.2f}%)", flush=True)

    print(f"\n🎉 V3 Dual-Stream Training Finished! Best Mean Accuracy: {best_mean_acc*100:.2f}%", flush=True)


if __name__ == "__main__":
    main()
