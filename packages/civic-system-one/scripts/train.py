#!/usr/bin/env python3
"""
Train the shared civic System 1 classifier.

Title and body keep every token. Titles in the training split are sometimes
blanked so an empty title still has a decision. The four heads are intent,
category, urgency, and stability. Township stays on each city's dictionary,
so this file does not learn city town names.
"""

import os
import sys
import time
import math
import json
import random
import hashlib
import argparse
from typing import List, Dict, Any, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, Sampler

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(SCRIPT_DIR, "../data/civic_jev.jsonl")
VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")
DEFAULT_CKPT = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint/best_model.pt")
DEFAULT_ONNX = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model.onnx")

ANSWER_ORDER = ["intent", "category", "urgency", "stability"]

CATEGORY_WEIGHTS = [1.2, 1.3, 1.0, 1.1, 1.0, 2.5, 1.0]

CRITERIA_CHOICES = {
    "intent": ["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"],
    "category": [
        "urban_management", "traffic", "market_reg", "environment",
        "labor_social", "public_safety", "social_governance",
    ],
    "urgency": ["Level 0", "Level 1", "Level 2", "Level 3"],
    "stability": ["YES", "NO"],
}


def is_holdout(ticket_no: str) -> bool:
    digest = hashlib.sha1(ticket_no.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 10 == 0


class DualStreamCivicTokenizer:
    def __init__(self, vocab_path: str, max_title_len: Optional[int] = None, max_body_len: Optional[int] = None):
        with open(vocab_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            self.tokens = data["tokens"]
        self.token_to_id = {tok: idx for idx, tok in enumerate(self.tokens)}
        self.pad_id = 0
        self.unk_id = 1
        self.max_title_len = max_title_len
        self.max_body_len = max_body_len

    def encode_str(self, text: str, max_len: Optional[int]) -> List[int]:
        tokens = []
        t = (text or "").strip()
        i = 0
        n = len(t)
        while i < n and (max_len is None or len(tokens) < max_len):
            if i + 4 <= n and t[i:i + 4] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i + 4]])
                i += 4
            elif i + 3 <= n and t[i:i + 3] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i + 3]])
                i += 3
            elif i + 2 <= n and t[i:i + 2] in self.token_to_id:
                tokens.append(self.token_to_id[t[i:i + 2]])
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
        return self.encode_str(title, self.max_title_len), self.encode_str(content, self.max_body_len)


class DualStreamDatasetV4(Dataset):
    def __init__(
        self,
        rows: List[Dict[str, Any]],
        tokenizer: DualStreamCivicTokenizer,
        blank_title_prob: float = 0.0,
        rng: Optional[random.Random] = None,
    ):
        self.samples = []
        self.tokenizer = tokenizer
        self.blanked = 0
        choice_sets = {dim: set(choices) for dim, choices in CRITERIA_CHOICES.items()}
        for row in rows:
            title = row.get("title") or ""
            if blank_title_prob and rng is not None and rng.random() < blank_title_prob:
                title = ""
                self.blanked += 1
            content = row.get("content") or row.get("state") or ""
            answers = row.get("answers") or []
            if len(answers) < len(ANSWER_ORDER):
                raise ValueError(f"{row.get('ticketNo')} answers 不足四项")
            for dim, answer in zip(ANSWER_ORDER, answers):
                if answer not in choice_sets[dim]:
                    raise ValueError(f"{row.get('ticketNo')} {dim}={answer!r}")
            title_tokens, body_tokens = tokenizer.encode(title, content)
            self.samples.append({
                "title_tokens": title_tokens,
                "body_tokens": body_tokens,
                "answers": list(answers[: len(ANSWER_ORDER)]),
            })

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


class BucketBatchSampler(Sampler[List[int]]):
    """Group similar body lengths, then shuffle the groups. No row is dropped."""

    def __init__(self, lengths: List[int], batch_size: int, shuffle: bool, seed: int):
        self.lengths = lengths
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.seed = seed
        self.epoch = 0

    def __iter__(self):
        rng = random.Random(self.seed + self.epoch)
        self.epoch += 1
        order = sorted(range(len(self.lengths)), key=lambda i: (self.lengths[i], i))
        batches = [order[i:i + self.batch_size] for i in range(0, len(order), self.batch_size)]
        if self.shuffle:
            rng.shuffle(batches)
        return iter(batches)

    def __len__(self):
        return math.ceil(len(self.lengths) / self.batch_size)


def collate_fn_v4(batch, pad_id=0):
    max_t = max(len(item["title_tokens"]) for item in batch)
    max_b = max(len(item["body_tokens"]) for item in batch)
    title_ids = torch.full((len(batch), max_t), pad_id, dtype=torch.long)
    title_mask = torch.zeros((len(batch), max_t), dtype=torch.float32)
    body_ids = torch.full((len(batch), max_b), pad_id, dtype=torch.long)
    body_mask = torch.zeros((len(batch), max_b), dtype=torch.float32)
    for i, item in enumerate(batch):
        title = item["title_tokens"]
        body = item["body_tokens"]
        title_ids[i, :len(title)] = torch.tensor(title, dtype=torch.long)
        title_mask[i, :len(title)] = 1.0
        body_ids[i, :len(body)] = torch.tensor(body, dtype=torch.long)
        body_mask[i, :len(body)] = 1.0

    targets = {}
    for index, dim_name in enumerate(ANSWER_ORDER):
        choices = CRITERIA_CHOICES[dim_name]
        labels = [choices.index(item["answers"][index]) for item in batch]
        targets[dim_name] = torch.tensor(labels, dtype=torch.long)
    return title_ids, title_mask, body_ids, body_mask, targets


class LayaDecisionModelV4(nn.Module):
    def __init__(
        self,
        vocab_size: int = 15000,
        emb_dim: int = 64,
        hidden_dim: int = 128,
        proj_dim: int = 256,
        nhead: int = 4,
    ):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, emb_dim, padding_idx=0)
        self.title_mlp = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )
        self.body_mlp = nn.Sequential(
            nn.Linear(emb_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )
        self.nhead = nhead
        self.q_proj = nn.Linear(emb_dim, emb_dim)
        self.k_proj = nn.Linear(emb_dim, emb_dim)
        self.v_proj = nn.Linear(emb_dim, emb_dim)
        self.out_proj = nn.Linear(emb_dim, emb_dim)
        self.cross_norm = nn.LayerNorm(emb_dim)
        self.fusion_mlp = nn.Sequential(
            nn.Linear(emb_dim * 3, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, proj_dim),
            nn.LayerNorm(proj_dim),
            nn.GELU(),
        )
        self.choice_proj = nn.Sequential(
            nn.Linear(proj_dim, proj_dim),
            nn.LayerNorm(proj_dim),
            nn.GELU(),
            nn.Linear(proj_dim, proj_dim),
        )
        self.temperature = nn.Parameter(torch.ones([]) * math.log(1 / 0.07))
        self.choice_embeddings = nn.ParameterDict({
            dim: nn.Parameter(torch.randn(len(choices), proj_dim) / math.sqrt(proj_dim))
            for dim, choices in CRITERIA_CHOICES.items()
        })

    def cross_attend(self, query, key, key_padding):
        # query [B, Tq, D], key [B, Tk, D], key_padding True on pads.
        # Sizes stay symbolic so ONNX does not bake the example length.
        heads = self.nhead
        head_dim = query.size(-1) // heads
        q = self.q_proj(query).view(query.size(0), query.size(1), heads, head_dim).permute(0, 2, 1, 3)
        k = self.k_proj(key).view(key.size(0), key.size(1), heads, head_dim).permute(0, 2, 1, 3)
        v = self.v_proj(key).view(key.size(0), key.size(1), heads, head_dim).permute(0, 2, 1, 3)
        scores = torch.matmul(q, k.transpose(-1, -2)) / math.sqrt(head_dim)
        scores = scores.masked_fill(key_padding[:, None, None, :], -1e9)
        weights = torch.softmax(scores, dim=-1)
        mixed = torch.matmul(weights, v).permute(0, 2, 1, 3).contiguous()
        mixed = mixed.view(query.size(0), query.size(1), query.size(-1))
        return self.out_proj(mixed)

    def forward(self, title_ids, title_mask, body_ids, body_mask, dim_name: str = None):
        t_emb = self.embedding(title_ids)
        b_emb = self.embedding(body_ids)
        t_m = title_mask.unsqueeze(-1)
        b_m = body_mask.unsqueeze(-1)
        t_pool = (t_emb * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)
        b_pool = (b_emb * b_m).sum(dim=1) / torch.clamp(b_m.sum(dim=1), min=1e-9)
        cross_out = self.cross_attend(t_emb, b_emb, body_mask == 0)
        cross_norm = self.cross_norm(cross_out + t_emb)
        cross_pool = (cross_norm * t_m).sum(dim=1) / torch.clamp(t_m.sum(dim=1), min=1e-9)
        fused_in = torch.cat([t_pool, cross_pool, b_pool], dim=-1)
        state_repr = F.normalize(self.fusion_mlp(fused_in), p=2, dim=-1)
        scale = torch.clamp(torch.exp(self.temperature), min=1.0, max=50.0)
        if dim_name is not None:
            choice_repr = F.normalize(self.choice_proj(self.choice_embeddings[dim_name]), p=2, dim=-1)
            return torch.matmul(state_repr, choice_repr.t()) * scale
        outputs = {}
        for dim, choices in self.choice_embeddings.items():
            choice_repr = F.normalize(self.choice_proj(choices), p=2, dim=-1)
            outputs[dim] = torch.matmul(state_repr, choice_repr.t()) * scale
        return outputs


class OnnxExport(nn.Module):
    def __init__(self, model: LayaDecisionModelV4):
        super().__init__()
        self.model = model

    def forward(self, title_ids, title_mask, body_ids, body_mask):
        out = self.model(title_ids, title_mask, body_ids, body_mask)
        return tuple(out[dim] for dim in ANSWER_ORDER)


def train_epoch_v4(model, dataloader, optimizer, scheduler, device, epoch, total_epochs, cat_weights):
    model.train()
    total_loss = 0.0
    t0 = time.perf_counter()
    steps = len(dataloader)
    for step, (t_ids, t_mask, b_ids, b_mask, targets) in enumerate(dataloader):
        t_ids = t_ids.to(device)
        t_mask = t_mask.to(device)
        b_ids = b_ids.to(device)
        b_mask = b_mask.to(device)
        optimizer.zero_grad()
        outputs = model(t_ids, t_mask, b_ids, b_mask)
        loss = 0.0
        for dim in ANSWER_ORDER:
            target = targets[dim].to(device)
            logits = outputs[dim]
            if dim == "category":
                dim_loss = F.cross_entropy(logits, target, weight=cat_weights)
            elif dim == "stability":
                dim_loss = F.cross_entropy(logits, target, weight=torch.tensor([1.0, 4.0], device=device))
            elif dim == "urgency":
                dim_loss = F.cross_entropy(logits, target, weight=torch.tensor([1.0, 1.0, 2.0, 4.0], device=device))
            else:
                dim_loss = F.cross_entropy(logits, target)
            loss = loss + dim_loss
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        scheduler.step()
        total_loss += loss.item()
        if (step + 1) % 200 == 0 or (step + 1) == steps:
            elapsed = time.perf_counter() - t0
            seen = (step + 1) * t_ids.size(0)
            print(
                f"   [Epoch {epoch}/{total_epochs}] Step {step + 1}/{steps} | "
                f"Loss: {total_loss / (step + 1):.4f} | Speed: {seen / elapsed:.1f} samples/s",
                flush=True,
            )
    return total_loss / max(steps, 1)


def evaluate_v4(model, dataloader, device):
    model.eval()
    correct = {dim: 0 for dim in ANSWER_ORDER}
    total = 0
    with torch.no_grad():
        for t_ids, t_mask, b_ids, b_mask, targets in dataloader:
            t_ids = t_ids.to(device)
            t_mask = t_mask.to(device)
            b_ids = b_ids.to(device)
            b_mask = b_mask.to(device)
            total += t_ids.size(0)
            outputs = model(t_ids, t_mask, b_ids, b_mask)
            for dim in ANSWER_ORDER:
                pred = outputs[dim].argmax(dim=-1)
                correct[dim] += (pred == targets[dim].to(device)).sum().item()
    accs = {dim: (correct[dim] / total if total else 0.0) for dim in ANSWER_ORDER}
    accs["mean"] = float(np.mean([accs[dim] for dim in ANSWER_ORDER]))
    accs["count"] = total
    return accs


def export_onnx(model: LayaDecisionModelV4, path: str):
    model_cpu = model.cpu().eval()
    wrapper = OnnxExport(model_cpu).eval()
    title_ids = torch.zeros(1, 4, dtype=torch.long)
    title_mask = torch.ones(1, 4, dtype=torch.float32)
    body_ids = torch.zeros(1, 8, dtype=torch.long)
    body_mask = torch.ones(1, 8, dtype=torch.float32)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    torch.onnx.export(
        wrapper,
        (title_ids, title_mask, body_ids, body_mask),
        tmp,
        input_names=["title_ids", "title_mask", "body_ids", "body_mask"],
        output_names=[f"{dim}_logits" for dim in ANSWER_ORDER],
        dynamic_axes={
            "title_ids": {0: "batch_size", 1: "title_len"},
            "title_mask": {0: "batch_size", 1: "title_len"},
            "body_ids": {0: "batch_size", 1: "body_len"},
            "body_mask": {0: "batch_size", 1: "body_len"},
            **{f"{dim}_logits": {0: "batch_size"} for dim in ANSWER_ORDER},
        },
        opset_version=17,
        dynamo=False,
    )
    os.replace(tmp, path)
    import onnx
    exported = onnx.load(path)
    length_meta = exported.metadata_props.add()
    length_meta.key = "civic_length"
    length_meta.value = "full"
    class_meta = exported.metadata_props.add()
    class_meta.key = "civic_classes"
    class_meta.value = ",".join(label for dim in ANSWER_ORDER for label in CRITERIA_CHOICES[dim])
    onnx.save(exported, path)


def score_onnx(onnx_path: str, dataset: DualStreamDatasetV4, batch_size: int) -> Dict[str, float]:
    import onnxruntime as ort

    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    names = [item.name for item in session.get_outputs()]
    expected = [f"{dim}_logits" for dim in ANSWER_ORDER]
    if names != expected:
        raise SystemExit(f"ONNX 输出 {names} 与 {expected} 不一致")
    if any(name.startswith("township") for name in names):
        raise SystemExit(f"共享模型不应输出镇街: {names}")
    loader = DataLoader(
        dataset,
        batch_sampler=BucketBatchSampler(
            [len(sample["body_tokens"]) for sample in dataset.samples],
            batch_size,
            shuffle=False,
            seed=0,
        ),
        collate_fn=collate_fn_v4,
        num_workers=0,
    )
    correct = {dim: 0 for dim in ANSWER_ORDER}
    total = 0
    for t_ids, t_mask, b_ids, b_mask, targets in loader:
        feeds = {
            "title_ids": t_ids.numpy().astype(np.int64),
            "title_mask": t_mask.numpy().astype(np.float32),
            "body_ids": b_ids.numpy().astype(np.int64),
            "body_mask": b_mask.numpy().astype(np.float32),
        }
        outputs = session.run(expected, feeds)
        total += t_ids.size(0)
        for index, dim in enumerate(ANSWER_ORDER):
            pred = outputs[index].argmax(axis=-1)
            correct[dim] += int((pred == targets[dim].numpy()).sum())
    accs = {dim: correct[dim] / total for dim in ANSWER_ORDER}
    accs["count"] = total
    return accs


def read_rows(path: str) -> List[Dict[str, Any]]:
    rows = []
    seen = set()
    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            ticket_no = str(row.get("ticketNo") or "")
            if not ticket_no:
                raise SystemExit(f"{path}:{line_no} 缺少工单编号")
            if ticket_no in seen:
                raise SystemExit(f"重复工单编号 {ticket_no}")
            seen.add(ticket_no)
            if not (row.get("content") or row.get("state")):
                raise SystemExit(f"{ticket_no} 缺少正文")
            rows.append(row)
    return rows


def write_regression(path: str, train_count: int, heldout_count: int, accs: Dict[str, float]):
    lines = [
        f"train_count {train_count}",
        f"heldout_count {heldout_count}",
    ]
    for dim in ANSWER_ORDER:
        lines.append(f"{dim} {accs[dim]:.6f}")
    text = "\n".join(lines) + "\n"
    if path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    print(text, end="", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Train the shared four-head civic System 1")
    parser.add_argument("--data", default=DEFAULT_DATA)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-3)
    parser.add_argument("--blank-prob", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=20261001)
    parser.add_argument("--ckpt-out", default=DEFAULT_CKPT)
    parser.add_argument("--onnx-out", default=DEFAULT_ONNX)
    parser.add_argument("--regression-out", default="")
    args = parser.parse_args()

    started = time.perf_counter()
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device {device}", flush=True)
    print(f"heads {ANSWER_ORDER}", flush=True)

    rows = read_rows(args.data)
    train_rows = [row for row in rows if not is_holdout(str(row["ticketNo"]))]
    holdout_rows = [row for row in rows if is_holdout(str(row["ticketNo"]))]
    if not train_rows or not holdout_rows:
        raise SystemExit(f"切分失败 train={len(train_rows)} holdout={len(holdout_rows)}")
    train_ids = {row["ticketNo"] for row in train_rows}
    if train_ids & {row["ticketNo"] for row in holdout_rows}:
        raise SystemExit("训练集和留出集有重叠")
    print(f"rows {len(rows)} train {len(train_rows)} holdout {len(holdout_rows)}", flush=True)

    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=None, max_body_len=None)
    rng = random.Random(args.seed)
    train_dataset = DualStreamDatasetV4(train_rows, tokenizer, blank_title_prob=args.blank_prob, rng=rng)
    holdout_dataset = DualStreamDatasetV4(holdout_rows, tokenizer, blank_title_prob=0.0, rng=None)
    max_body = max(len(sample["body_tokens"]) for sample in train_dataset.samples + holdout_dataset.samples)
    max_title = max(len(sample["title_tokens"]) for sample in train_dataset.samples + holdout_dataset.samples)
    print(f"max_title_tokens {max_title} max_body_tokens {max_body} blanked_titles {train_dataset.blanked}", flush=True)
    if max_body <= 128:
        raise SystemExit(f"正文最长只有 {max_body} 个 token，全文没有进训练")

    train_loader = DataLoader(
        train_dataset,
        batch_sampler=BucketBatchSampler(
            [len(sample["body_tokens"]) for sample in train_dataset.samples],
            args.batch_size,
            shuffle=True,
            seed=args.seed,
        ),
        collate_fn=collate_fn_v4,
        num_workers=0,
    )
    holdout_loader = DataLoader(
        holdout_dataset,
        batch_sampler=BucketBatchSampler(
            [len(sample["body_tokens"]) for sample in holdout_dataset.samples],
            args.batch_size,
            shuffle=False,
            seed=args.seed,
        ),
        collate_fn=collate_fn_v4,
        num_workers=0,
    )

    model = LayaDecisionModelV4(
        vocab_size=len(tokenizer.tokens),
        emb_dim=64,
        hidden_dim=128,
        proj_dim=256,
        nhead=4,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total_steps = max(len(train_loader) * args.epochs, 1)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_steps, eta_min=1e-5)
    cat_weights = torch.tensor(CATEGORY_WEIGHTS, dtype=torch.float32, device=device)
    os.makedirs(os.path.dirname(args.ckpt_out), exist_ok=True)
    best_mean = -1.0

    for epoch in range(1, args.epochs + 1):
        loss = train_epoch_v4(model, train_loader, optimizer, scheduler, device, epoch, args.epochs, cat_weights)
        accs = evaluate_v4(model, holdout_loader, device)
        print(
            f"epoch {epoch} loss {loss:.4f} "
            + " ".join(f"{dim} {accs[dim]:.4f}" for dim in ANSWER_ORDER),
            flush=True,
        )
        if accs["mean"] > best_mean:
            best_mean = accs["mean"]
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_accs": {dim: accs[dim] for dim in ANSWER_ORDER},
                "vocab_size": len(tokenizer.tokens),
                "emb_dim": 64,
                "hidden_dim": 128,
                "proj_dim": 256,
                "criteria": CRITERIA_CHOICES,
                "train_count": len(train_rows),
                "heldout_count": len(holdout_rows),
            }, args.ckpt_out)
            print(f"saved {args.ckpt_out}", flush=True)

    ckpt = torch.load(args.ckpt_out, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    export_onnx(model, args.onnx_out)
    print(f"exported {args.onnx_out}", flush=True)
    onnx_accs = score_onnx(args.onnx_out, holdout_dataset, args.batch_size)
    write_regression(args.regression_out, len(train_rows), len(holdout_rows), onnx_accs)
    print(f"TRAIN_SECONDS {time.perf_counter() - started:.1f}", flush=True)


if __name__ == "__main__":
    main()
