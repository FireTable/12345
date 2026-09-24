#!/usr/bin/env python3
"""
@civic/system-one: Unified Benchmark Tool (V2 vs V3 vs V4 vs Base Laya)
========================================================================
Supports both Sample Mode (default: 10,000 samples) and Full-Scale Mode (128,278 records).
Benchmarks across:
- Engine 0: @civic/system-one V4 Cross-Attention ONNX Runtime (CPU 8-thread)
- Engine 1: @civic/system-one V3 Dual-Stream ONNX Runtime (CPU 8-thread)
- Engine 2: @civic/system-one V3 Dual-Stream PyTorch Metal GPU (MPS)
- Engine 3: @civic/system-one V2 Single-Stream ONNX Runtime (CPU 8-thread)
- Engine 4: afshinm/laya-mps (Base ModernBERT-large 1.68GB)

Usage:
  python3 packages/civic-system-one/scripts/benchmark.py --mode sample --sample-size 10000
  python3 packages/civic-system-one/scripts/benchmark.py --mode full --engine v4-onnx
  python3 packages/civic-system-one/scripts/benchmark.py --mode sample --audit 25
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

# Add script directory to sys.path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train_laya_v2 import LayaDecisionModelV2, FastCivicTokenizer, CRITERIA_CHOICES
from train_laya_v3 import LayaDecisionModelV3, DualStreamCivicTokenizer
from train_laya_v4 import LayaDecisionModelV4

DEFAULT_FULL_EXCEL = "/Users/FireTable/Downloads/政数局资料-顺德区12345热线工单（2025年1月至3月）.xlsx"
DEFAULT_SAMPLE_EXCEL = "/Users/FireTable/Downloads/sample_300.xlsx"
VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")

# V4 Paths (Cross-Attention Dual-Stream)
CHECKPOINT_V4_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v4/best_model.pt")
ONNX_V4_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_v4.onnx")

# V3 Paths
CHECKPOINT_V3_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v3/best_model.pt")
ONNX_V3_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_v3.onnx")

# V2 Paths
CHECKPOINT_V2_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-checkpoint-v2/best_model.pt")
ONNX_V2_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_v2.onnx")

# Base Laya
BASE_LAYA_PATH = os.path.expanduser("~/.cache/receptron-laya/receptron--laya-onnx/main/laya.onnx")

BATCH_SIZE = 1024


def load_dataset(file_path: str, mode: str = "sample", sample_size: int = 10000):
    if not file_path or not os.path.exists(file_path):
        if os.path.exists(DEFAULT_FULL_EXCEL):
            file_path = DEFAULT_FULL_EXCEL
        elif mode == "sample" and os.path.exists(DEFAULT_SAMPLE_EXCEL):
            file_path = DEFAULT_SAMPLE_EXCEL
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


# -------------------------------------------------------------
# Engine 0: V4 Cross-Attention Dual-Stream ONNX Runtime (CPU)
# -------------------------------------------------------------
def run_benchmark_onnx_v4(records, onnx_path):
    print(f"\n=======================================================")
    print(f"🚀 [Engine] @civic/system-one V4 Cross-Attention (ONNX Runtime CPU)")
    print(f"=======================================================")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 8
    sess = ort.InferenceSession(onnx_path, session_options, providers=["CPUExecutionProvider"])
    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)

    total_records = len(records)
    batch_size = min(BATCH_SIZE, total_records)
    all_intents, all_cats, all_urgs, all_stabs = [], [], [], []

    t_start = time.perf_counter()
    inf_time = 0.0

    for start_idx in range(0, total_records, batch_size):
        end_idx = min(start_idx + batch_size, total_records)
        b_records = records[start_idx:end_idx]
        cur_b_size = len(b_records)

        t_ids = np.zeros((cur_b_size, 32), dtype=np.int64)
        t_mask = np.zeros((cur_b_size, 32), dtype=np.float32)
        b_ids = np.zeros((cur_b_size, 128), dtype=np.int64)
        b_mask = np.zeros((cur_b_size, 128), dtype=np.float32)

        for i, r in enumerate(b_records):
            t_toks, b_toks = tokenizer.encode(r["title"], r["content"])
            nt = min(len(t_toks), 32)
            nb = min(len(b_toks), 128)
            t_ids[i, :nt] = t_toks[:nt]
            t_mask[i, :nt] = 1.0
            b_ids[i, :nb] = b_toks[:nb]
            b_mask[i, :nb] = 1.0

        t0 = time.perf_counter()
        outs = sess.run(None, {
            "title_ids": t_ids,
            "title_mask": t_mask,
            "body_ids": b_ids,
            "body_mask": b_mask
        })
        inf_time += (time.perf_counter() - t0)

        # outs: [category_logits, intent_logits, urgency_logits, stability_logits]
        all_cats.extend(np.argmax(outs[0], axis=-1).tolist())
        all_intents.extend(np.argmax(outs[1], axis=-1).tolist())
        all_urgs.extend(np.argmax(outs[2], axis=-1).tolist())
        all_stabs.extend(np.argmax(outs[3], axis=-1).tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "@civic/system-one V4 Cross-Attention (ONNX 4.5MB)",
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


# -------------------------------------------------------------
# Engine 1: V3 Dual-Stream ONNX Runtime (CPU)
# -------------------------------------------------------------
def run_benchmark_onnx_v3(records, onnx_path):
    print(f"\n=======================================================")
    print(f"⚡ [Engine] @civic/system-one V3 Dual-Stream (ONNX Runtime CPU)")
    print(f"=======================================================")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 8
    sess = ort.InferenceSession(onnx_path, session_options, providers=["CPUExecutionProvider"])
    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)

    total_records = len(records)
    batch_size = min(BATCH_SIZE, total_records)
    all_intents, all_cats, all_urgs, all_stabs = [], [], [], []

    t_start = time.perf_counter()
    inf_time = 0.0

    for start_idx in range(0, total_records, batch_size):
        end_idx = min(start_idx + batch_size, total_records)
        b_records = records[start_idx:end_idx]
        cur_b_size = len(b_records)

        # Batch tokenization
        t_ids = np.zeros((cur_b_size, 32), dtype=np.int64)
        t_mask = np.zeros((cur_b_size, 32), dtype=np.float32)
        b_ids = np.zeros((cur_b_size, 128), dtype=np.int64)
        b_mask = np.zeros((cur_b_size, 128), dtype=np.float32)

        for i, r in enumerate(b_records):
            t_toks, b_toks = tokenizer.encode(r["title"], r["content"])
            nt = min(len(t_toks), 32)
            nb = min(len(b_toks), 128)
            t_ids[i, :nt] = t_toks[:nt]
            t_mask[i, :nt] = 1.0
            b_ids[i, :nb] = b_toks[:nb]
            b_mask[i, :nb] = 1.0

        t0 = time.perf_counter()
        outs = sess.run(None, {
            "title_ids": t_ids,
            "title_mask": t_mask,
            "body_ids": b_ids,
            "body_mask": b_mask
        })
        inf_time += (time.perf_counter() - t0)

        all_intents.extend(np.argmax(outs[0], axis=-1).tolist())
        all_cats.extend(np.argmax(outs[1], axis=-1).tolist())
        all_urgs.extend(np.argmax(outs[2], axis=-1).tolist())
        all_stabs.extend(np.argmax(outs[3], axis=-1).tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "@civic/system-one V3 ONNX (Dual-Stream 5MB)",
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


# -------------------------------------------------------------
# Engine 2: V3 Dual-Stream PyTorch Metal GPU (MPS)
# -------------------------------------------------------------
def run_benchmark_mps_v3(records, ckpt_path):
    print(f"\n=======================================================")
    print(f"🍏 [Engine] @civic/system-one V3 Dual-Stream (PyTorch Metal GPU / MPS)")
    print(f"=======================================================")
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")

    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)

    model = LayaDecisionModelV3(
        vocab_size=ckpt.get("vocab_size", len(tokenizer.tokens)),
        emb_dim=ckpt.get("emb_dim", 64),
        hidden_dim=ckpt.get("hidden_dim", 128),
        proj_dim=ckpt.get("proj_dim", 256),
        num_tf_layers=2
    )
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
            b_records = records[start_idx:end_idx]
            cur_b_size = len(b_records)

            t_ids = torch.zeros((cur_b_size, 32), dtype=torch.long, device=device)
            t_mask = torch.zeros((cur_b_size, 32), dtype=torch.float32, device=device)
            b_ids = torch.zeros((cur_b_size, 128), dtype=torch.long, device=device)
            b_mask = torch.zeros((cur_b_size, 128), dtype=torch.float32, device=device)

            for i, r in enumerate(b_records):
                t_toks, b_toks = tokenizer.encode(r["title"], r["content"])
                nt = min(len(t_toks), 32)
                nb = min(len(b_toks), 128)
                t_ids[i, :nt] = torch.tensor(t_toks[:nt], device=device)
                t_mask[i, :nt] = 1.0
                b_ids[i, :nb] = torch.tensor(b_toks[:nb], device=device)
                b_mask[i, :nb] = 1.0

            t0 = time.perf_counter()
            outputs = model(t_ids, t_mask, b_ids, b_mask)
            if device.type == "mps":
                torch.mps.synchronize()
            inf_time += (time.perf_counter() - t0)

            all_intents.extend(outputs["intent"].argmax(dim=-1).cpu().numpy().tolist())
            all_cats.extend(outputs["category"].argmax(dim=-1).cpu().numpy().tolist())
            all_urgs.extend(outputs["urgency"].argmax(dim=-1).cpu().numpy().tolist())
            all_stabs.extend(outputs["stability"].argmax(dim=-1).cpu().numpy().tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "@civic/system-one V3 Metal MPS (5MB)",
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


# -------------------------------------------------------------
# Engine 3: V2 Baseline ONNX Runtime (CPU)
# -------------------------------------------------------------
def run_benchmark_onnx_v2(records, onnx_path):
    print(f"\n=======================================================")
    print(f"⚡ [Engine] @civic/system-one V2 Baseline (ONNX Runtime CPU)")
    print(f"=======================================================")
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 8
    sess = ort.InferenceSession(onnx_path, session_options, providers=["CPUExecutionProvider"])
    tokenizer = FastCivicTokenizer(VOCAB_PATH, max_seq_len=128)

    total_records = len(records)
    batch_size = min(BATCH_SIZE, total_records)
    all_intents, all_cats, all_urgs, all_stabs = [], [], [], []

    t_start = time.perf_counter()
    inf_time = 0.0

    for start_idx in range(0, total_records, batch_size):
        end_idx = min(start_idx + batch_size, total_records)
        b_records = records[start_idx:end_idx]
        cur_b_size = len(b_records)

        inp_ids = np.zeros((cur_b_size, 128), dtype=np.int64)
        mask = np.zeros((cur_b_size, 128), dtype=np.float32)

        for i, r in enumerate(b_records):
            tokens = tokenizer.encode(r["full_text"])
            n = min(len(tokens), 128)
            inp_ids[i, :n] = tokens[:n]
            mask[i, :n] = 1.0

        t0 = time.perf_counter()
        outs = sess.run(None, {"input_ids": inp_ids, "attention_mask": mask})
        inf_time += (time.perf_counter() - t0)

        all_intents.extend(np.argmax(outs[0], axis=-1).tolist())
        all_cats.extend(np.argmax(outs[1], axis=-1).tolist())
        all_urgs.extend(np.argmax(outs[2], axis=-1).tolist())
        all_stabs.extend(np.argmax(outs[3], axis=-1).tolist())

    total_time = time.perf_counter() - t_start
    return {
        "engine": "@civic/system-one V2 ONNX (Single-Stream 4.5MB)",
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


# -------------------------------------------------------------
# Engine 4: Base ModernBERT 1.68GB (afshinm/laya-mps)
# -------------------------------------------------------------
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


def run_audit(records, results_engine, audit_count=15):
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
    header = f"{'Engine / Model':<45} | {'Tickets':<8} | {'Total Time':<11} | {'Per-Item':<12} | {'Throughput':<15}"
    print(header)
    print("-" * len(header))
    for m in metrics_list:
        if not m:
            continue
        print(f"{m['engine']:<45} | {m['total_records']:<8,} | {m['total_time_sec']:<8.2f} s | {m['latency_per_record_ms']:<8.4f} ms | {m['throughput_tps']:<10.1f} TPS")
    print("=" * len(header) + "\n")


def main():
    parser = argparse.ArgumentParser(description="@civic/system-one Unified Benchmark")
    parser.add_argument("--file", type=str, default="", help="Path to input Excel dataset")
    parser.add_argument("--mode", type=str, choices=["sample", "full"], default="sample", help="Benchmark mode: sample (default: 3000) or full (128k)")
    parser.add_argument("--sample-size", type=int, default=10000, help="Number of samples to evaluate in sample mode (default: 10000)")
    parser.add_argument("--engine", type=str, choices=["all", "v4-onnx", "v3-onnx", "v3-mps", "v2-onnx", "base"], default="all", help="Engine to benchmark")
    parser.add_argument("--audit", type=int, default=15, help="Number of records to spot-check audit (0 to disable)")
    parser.add_argument("--output", type=str, default="", help="Optional path to output json report")
    args = parser.parse_args()

    records = load_dataset(args.file, mode=args.mode, sample_size=args.sample_size)
    metrics = []

    # 0. V4 Cross-Attention ONNX
    if args.engine in ["all", "v4-onnx"]:
        res_v4_onnx = run_benchmark_onnx_v4(records, ONNX_V4_PATH)
        metrics.append(res_v4_onnx)

    # 1. V3 ONNX
    if args.engine in ["all", "v3-onnx"]:
        res_v3_onnx = run_benchmark_onnx_v3(records, ONNX_V3_PATH)
        metrics.append(res_v3_onnx)

    # 2. V3 MPS
    if args.engine in ["all", "v3-mps"]:
        res_v3_mps = run_benchmark_mps_v3(records, CHECKPOINT_V3_PATH)
        metrics.append(res_v3_mps)

    # 3. V2 ONNX Baseline
    if args.engine in ["all", "v2-onnx"]:
        res_v2_onnx = run_benchmark_onnx_v2(records, ONNX_V2_PATH)
        metrics.append(res_v2_onnx)

    # 4. Base Laya (only in sample mode or if specifically requested)
    if args.engine in ["all", "base"] and args.mode == "sample":
        res_base = run_benchmark_base_laya(records, BASE_LAYA_PATH, max_records=min(len(records), 100))
        if res_base:
            metrics.append(res_base)

    # Print summary table
    print_comparison_table(metrics)

    # Audit with top engine (V3 ONNX)
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
