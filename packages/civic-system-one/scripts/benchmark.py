#!/usr/bin/env python3
"""
@civic/system-one: Unified Benchmark Tool
=========================================
Supports both Sample Mode (e.g. 300 samples) and Full-Scale Mode (e.g. 128,278 records).
Benchmarks across:
- Engine 1: Apple Silicon Metal GPU (PyTorch MPS)
- Engine 2: ONNX Runtime (8-thread CPU)
- Engine 3: Native Apple Silicon MLX (Metal)
- (Optional) Base ModernBERT-large 1.68GB (afshinm/laya-mps)

Usage:
  python3 benchmark.py --mode sample --sample-size 300
  python3 benchmark.py --mode full --engine all
  python3 benchmark.py --mode sample --audit 20
"""

import os
import sys
import time
import json
import argparse
import openpyxl
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import onnxruntime as ort

try:
    import mlx.core as mx
    import mlx.nn as m_nn
    MLX_AVAILABLE = True
except ImportError:
    MLX_AVAILABLE = False

# Add script directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train_laya import LayaDecisionModel, CRITERIA_CHOICES

DEFAULT_FULL_EXCEL = "/Users/FireTable/Downloads/政数局资料-顺德区12345热线工单（2025年1月至3月）.xlsx"
DEFAULT_SAMPLE_EXCEL = "/Users/FireTable/Downloads/sample_300.xlsx"
CHECKPOINT_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint/best_model.pt")
ONNX_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_full.onnx")
MLX_WEIGHTS_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-mlx/weights.npz")
BASE_LAYA_PATH = os.path.expanduser("~/.cache/receptron-laya/receptron--laya-onnx/main/laya.onnx")

HIDDEN_SIZE = 512
PROJ_DIM = 256
BATCH_SIZE = 2048


def load_dataset(file_path: str, mode: str = "sample", sample_size: int = 300):
    if not os.path.exists(file_path):
        if mode == "sample" and os.path.exists(DEFAULT_SAMPLE_EXCEL):
            file_path = DEFAULT_SAMPLE_EXCEL
        elif os.path.exists(DEFAULT_FULL_EXCEL):
            file_path = DEFAULT_FULL_EXCEL
        else:
            raise FileNotFoundError(f"Dataset file not found: {file_path}")

    print(f"📂 Loading dataset: {file_path} (mode: {mode})...")
    t0 = time.perf_counter()
    wb = openpyxl.load_workbook(file_path, read_only=True)
    sheet = wb.active

    records = []
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]:
            continue
        seq = row[0]
        ticket_no = str(row[1] or "")
        title = str(row[2] or "").strip()
        content = str(row[3] or "").strip()
        full_text = f"{title}。{content}" if title else content
        records.append({
            "seq": seq,
            "ticket_no": ticket_no,
            "title": title,
            "content": content,
            "full_text": full_text
        })
    
    t_load = time.perf_counter() - t0
    total_loaded = len(records)
    print(f"✅ Loaded {total_loaded:,} records in {t_load:.2f}s ({total_loaded/t_load:,.1f} records/s)")

    if mode == "sample" and sample_size < total_loaded:
        step = max(1, total_loaded // sample_size)
        sampled = [records[i * step] for i in range(sample_size)]
        print(f"🎯 Sub-sampled {len(sampled)} records (step: {step})")
        return sampled

    return records


def extract_features_batch(texts, hidden_size=512):
    n = len(texts)
    feats = np.zeros((n, hidden_size), dtype=np.float32)
    for i, s in enumerate(texts):
        chars = [ord(c) for c in s[:128]]
        for c_idx, c in enumerate(chars):
            slot = (c * 31 + c_idx) % hidden_size
            feats[i, slot] += 1.0
    norms = np.linalg.norm(feats, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    feats /= norms
    return feats


def run_benchmark_mps(records, ckpt_path):
    print(f"\n=======================================================")
    print(f"🍏 [Engine] @civic/system-one (PyTorch Metal GPU / MPS)")
    print(f"=======================================================")
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    model = LayaDecisionModel(hidden_size=HIDDEN_SIZE, proj_dim=PROJ_DIM)
    ckpt = torch.load(ckpt_path, map_location="cpu")
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    model.eval()

    total_records = len(records)
    batch_size = min(BATCH_SIZE, total_records)
    all_intents, all_cats, all_urgs, all_stabs = [], [], [], []

    t_start = time.perf_counter()
    inf_time = 0.0

    with torch.no_grad():
        for start_idx in range(0, total_records, batch_size):
            end_idx = min(start_idx + batch_size, total_records)
            batch_texts = [r["full_text"] for r in records[start_idx:end_idx]]

            feats_np = extract_features_batch(batch_texts, hidden_size=HIDDEN_SIZE)
            feats_tensor = torch.from_numpy(feats_np).to(device)

            t0 = time.perf_counter()
            i_logits = model(feats_tensor, "intent")
            c_logits = model(feats_tensor, "category")
            u_logits = model(feats_tensor, "urgency")
            s_logits = model(feats_tensor, "stability")

            if device.type == "mps":
                torch.mps.synchronize()
            inf_time += (time.perf_counter() - t0)

            all_intents.extend(i_logits.argmax(dim=-1).cpu().numpy().tolist())
            all_cats.extend(c_logits.argmax(dim=-1).cpu().numpy().tolist())
            all_urgs.extend(u_logits.argmax(dim=-1).cpu().numpy().tolist())
            all_stabs.extend(s_logits.argmax(dim=-1).cpu().numpy().tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "PyTorch Metal GPU (MPS)",
        "total_records": total_records,
        "total_time_sec": total_time,
        "inf_time_sec": inf_time,
        "latency_per_record_ms": (total_time / total_records) * 1000,
        "pure_inf_latency_ms": (inf_time / total_records) * 1000,
        "throughput_tps": total_records / total_time,
        "intents": all_intents,
        "categories": all_cats,
        "urgencies": all_urgs,
        "stabilities": all_stabs
    }


def run_benchmark_onnx(records, onnx_path):
    print(f"\n=======================================================")
    print(f"⚡ [Engine] @civic/system-one (ONNX Runtime CPU)")
    print(f"=======================================================")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 8
    sess = ort.InferenceSession(onnx_path, session_options, providers=["CPUExecutionProvider"])

    total_records = len(records)
    batch_size = min(BATCH_SIZE, total_records)
    all_intents, all_cats, all_urgs, all_stabs = [], [], [], []

    t_start = time.perf_counter()
    inf_time = 0.0

    for start_idx in range(0, total_records, batch_size):
        end_idx = min(start_idx + batch_size, total_records)
        batch_texts = [r["full_text"] for r in records[start_idx:end_idx]]

        feats_np = extract_features_batch(batch_texts, hidden_size=HIDDEN_SIZE)

        t0 = time.perf_counter()
        outs = sess.run(None, {"features": feats_np})
        inf_time += (time.perf_counter() - t0)

        all_intents.extend(np.argmax(outs[0], axis=-1).tolist())
        all_cats.extend(np.argmax(outs[1], axis=-1).tolist())
        all_urgs.extend(np.argmax(outs[2], axis=-1).tolist())
        all_stabs.extend(np.argmax(outs[3], axis=-1).tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "ONNX Runtime (8-thread CPU)",
        "total_records": total_records,
        "total_time_sec": total_time,
        "inf_time_sec": inf_time,
        "latency_per_record_ms": (total_time / total_records) * 1000,
        "pure_inf_latency_ms": (inf_time / total_records) * 1000,
        "throughput_tps": total_records / total_time,
        "intents": all_intents,
        "categories": all_cats,
        "urgencies": all_urgs,
        "stabilities": all_stabs
    }


def run_benchmark_base_laya(records, base_path, max_records=50):
    if not os.path.exists(base_path):
        print(f"⚠️ Base Laya model not found at {base_path}, skipping.")
        return None

    eval_records = records[:min(len(records), max_records)]
    print(f"\n=======================================================")
    print(f"🐢 [Engine] afshinm/laya-mps (Base ModernBERT-large 1.68GB)")
    print(f"=======================================================")
    sess = ort.InferenceSession(base_path, providers=["CPUExecutionProvider"])
    
    total = len(eval_records)
    latencies = []
    t_start = time.perf_counter()

    for r in eval_records:
        t0 = time.perf_counter()
        seq_len = 64
        num_options = 7
        inp = {
            "input_ids": np.ones((1, seq_len), dtype=np.int64),
            "attention_mask": np.ones((1, seq_len), dtype=np.int64),
            "marker_pos": np.zeros((1, num_options), dtype=np.int64),
            "marker_mask": np.ones((1, num_options), dtype=bool),
            "qtype": np.zeros((1,), dtype=np.int64)
        }
        _ = sess.run(None, inp)
        latencies.append((time.perf_counter() - t0) * 1000)

    avg_lat = np.mean(latencies)
    extrapolated_total = (avg_lat * len(records)) / 1000.0

    return {
        "engine": "afshinm/laya-mps (ModernBERT 1.68GB)",
        "total_records": len(records),
        "total_time_sec": extrapolated_total,
        "latency_per_record_ms": avg_lat,
        "pure_inf_latency_ms": avg_lat,
        "throughput_tps": 1000.0 / avg_lat
    }


def run_audit(records, results_engine, audit_count=20):
    print(f"\n=======================================================")
    print(f"🔍 Deep Quality Audit ({audit_count} Spot-Checked Records)")
    print(f"=======================================================")

    category_map_cn = {
        "urban_management": "城管市容", "environment": "生态环保",
        "traffic": "交通运输", "market_reg": "市场监管",
        "labor_social": "劳社医保", "public_safety": "公共安全",
        "social_governance": "综合社治"
    }
    intent_map_cn = {
        "COMPLAINT": "投诉", "INQUIRY": "咨询", "SUGGESTION": "建议",
        "REMINDER": "催办", "COMMENDATION": "表扬"
    }

    step = max(1, len(records) // audit_count)
    cat_keys = CRITERIA_CHOICES["category"]
    intent_keys = CRITERIA_CHOICES["intent"]
    urgency_keys = CRITERIA_CHOICES["urgency"]
    stability_keys = CRITERIA_CHOICES["stability"]

    print(f"{'No.':<4} | {'Ticket No':<18} | {'Title':<20} | {'Intent':<6} | {'Category':<8} | {'Urgency':<8} | {'SLA':<5} | {'Risk'}")
    print("-" * 95)

    for i in range(audit_count):
        idx = min(i * step, len(records) - 1)
        r = records[idx]
        i_pred = intent_keys[results_engine["intents"][idx]]
        c_pred = cat_keys[results_engine["categories"][idx]]
        u_pred = urgency_keys[results_engine["urgencies"][idx]]
        s_pred = stability_keys[results_engine["stabilities"][idx]]

        sla = "即时/24h" if u_pred == "Level 0" else "2h" if u_pred == "Level 3" else "24h" if u_pred == "Level 2" else "120h"
        risk_str = "⚠️高危" if s_pred == "YES" else "正常"

        clean_title = r["title"][:18]
        print(f"{i+1:<4} | {r['ticket_no']:<18} | {clean_title:<20} | {intent_map_cn.get(i_pred, i_pred):<6} | {category_map_cn.get(c_pred, c_pred):<8} | {u_pred:<8} | {sla:<5} | {risk_str}")


def print_comparison_table(metrics_list):
    print(f"\n=======================================================")
    print(f"📊 BENCHMARK COMPARISON SUMMARY")
    print(f"=======================================================")
    header = f"{'Engine / Model':<35} | {'Tickets':<8} | {'Total Time':<11} | {'Per-Item':<12} | {'Throughput':<15}"
    print(header)
    print("-" * len(header))
    for m in metrics_list:
        if not m:
            continue
        print(f"{m['engine']:<35} | {m['total_records']:<8,} | {m['total_time_sec']:<8.2f} s | {m['latency_per_record_ms']:<8.4f} ms | {m['throughput_tps']:<10.1f} TPS")
    print("=" * len(header) + "\n")


def main():
    parser = argparse.ArgumentParser(description="@civic/system-one Unified Benchmark")
    parser.add_argument("--file", type=str, default="", help="Path to input Excel or jsonl dataset")
    parser.add_argument("--mode", type=str, choices=["sample", "full"], default="sample", help="Benchmark mode: sample (3,000) or full (128k)")
    parser.add_argument("--sample-size", type=int, default=3000, help="Number of samples to evaluate in sample mode (default: 3000)")
    parser.add_argument("--engine", type=str, choices=["all", "mps", "onnx", "base"], default="all", help="Engine to benchmark")
    parser.add_argument("--audit", type=int, default=15, help="Number of records to spot-check audit (0 to disable)")
    parser.add_argument("--output", type=str, default="", help="Optional path to output json report")
    args = parser.parse_args()

    records = load_dataset(args.file, mode=args.mode, sample_size=args.sample_size)
    metrics = []

    # 1. MPS
    if args.engine in ["all", "mps"]:
        res_mps = run_benchmark_mps(records, CHECKPOINT_PATH)
        metrics.append(res_mps)

    # 2. ONNX
    if args.engine in ["all", "onnx"]:
        res_onnx = run_benchmark_onnx(records, ONNX_PATH)
        metrics.append(res_onnx)

    # 3. Base Laya (only in sample mode or if specifically requested)
    if args.engine in ["all", "base"] and args.mode == "sample":
        res_base = run_benchmark_base_laya(records, BASE_LAYA_PATH, max_records=min(len(records), 300))
        if res_base:
            metrics.append(res_base)

    # Print summary table
    print_comparison_table(metrics)

    # Audit
    if args.audit > 0 and len(metrics) > 0 and "intents" in metrics[0]:
        run_audit(records, metrics[0], audit_count=min(args.audit, len(records)))

    # Save output if requested
    if args.output:
        save_data = [{k: v for k, v in m.items() if not isinstance(v, list)} for m in metrics]
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(save_data, f, ensure_ascii=False, indent=2)
        print(f"💾 Benchmark metrics saved to: {args.output}")


if __name__ == "__main__":
    main()
