#!/usr/bin/env python3
"""
Regression Test on 14 Historical Misclassified Civic Tickets
=============================================================
Tests V2 model on the 14 cases that were misclassified by V1:
1. 250122128360109-01 (购买沙发不发货 -> 市场监管)
2. 250124067650109-01 (公司注册一网通办 -> 市场监管)
3. 250207030510109-01 (机动车注册登记车管所 -> 交通运输)
4. 250212127990102-01 (网购热水器问题 -> 市场监管)
5. 250220121880109-01 (外资公司变更登记 -> 市场监管)
6. 250303154580109-01 (羽毛球馆消防要求 -> 公共安全)
7. 250304070060109-01 (（城管）游商占道经营 -> 城管市容)
8. 250310047990109-01 (失业金领取期限核查 -> 劳社医保)
9. 250311081860403-01 (重点群体就业认定证明 -> 劳社医保)
10. 250312008540111-01 (工业区消防安全隐患 -> 公共安全)
11. 250317141680109-01 (商品房居住权登记 -> 综合社治)
12. 250325147260105-01 (（城管）违建问题大棚 -> 城管市容)
13. 250327006830407-01 (公墓烈士碑代祭扫 -> 综合社治)
14. 250328059630102-01 (网购热水器万家乐居委会 -> 市场监管)
"""

import os
import sys
import torch
import onnxruntime as ort
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train_laya_v2 import FastCivicTokenizer, CRITERIA_CHOICES
from train_laya_v3 import DualStreamCivicTokenizer

VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")
ONNX_V2_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_v2.onnx")
ONNX_V3_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model_v3.onnx")

TEST_CASES = [
    {
        "id": "250122128360109-01",
        "title": "购买沙发",
        "content": "市民于2025年1月3日在拼多多平台购买沙发，市民表示直到2025年1月22日商家仍未发货，且平台介入无果，要求商家履行合同并尽快发货。",
        "expected_cat": "market_reg",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250124067650109-01",
        "title": "公司注册",
        "content": "市民于2025年1月24日早上通过一网通办线上申请内资公司注册，系统提示已核名，但在电子签名阶段报错，要求市场监督管理局协助处理系统异常。",
        "expected_cat": "market_reg",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250207030510109-01",
        "title": "机动车注册登记",
        "content": "市民于1月22日到顺德区车管所（新协力机动车登记服务站）办理新车上牌选号业务，预约系统一直提示排队已满，要求交警支队车管所增加预约号源。",
        "expected_cat": "traffic",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250212127990102-01",
        "title": "网购热水器问题",
        "content": "市民反映其2024年12月通过抖音向佛绅电器专营店购买电热水器，商家虚标能耗且上门安装私自加收高额辅料费，要求退货退款并赔偿损失。",
        "expected_cat": "market_reg",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250220121880109-01",
        "title": "外资公司变更登记",
        "content": "市民企业是外商投资企业，拟办理公司住所及法定代表人变更登记，向市场监督管理所咨询外资审批前置材料与备案流程。",
        "expected_cat": "market_reg",
        "expected_intent": "INQUIRY"
    },
    {
        "id": "250303154580109-01",
        "title": "羽毛球馆消防要求",
        "content": "市民来电咨询若在北滘镇租用废旧工业厂房改建成民营羽毛球体育馆，根据建设工程消防设计审查验收规定，需要满足哪些消防通道与喷淋设施要求？",
        "expected_cat": "public_safety",
        "expected_intent": "INQUIRY"
    },
    {
        "id": "250304070060109-01",
        "title": "（回访）(城管）游商占道经营",
        "content": "市民反映大良街道沿江路每天下午17点后有无证流动小贩推三轮车摆摊炸串，占道经营严重阻碍车道正常行车通行，要求城管执法部门取缔乱摆卖。",
        "expected_cat": "urban_management",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250310047990109-01",
        "title": "失业金领取期限",
        "content": "市民致电咨询人社局社保中心，其之前累计缴费满3年零8个月，本次非因本人意愿中断就业，希望核实其失业保险金法定享受月数是几个月。",
        "expected_cat": "labor_social",
        "expected_intent": "INQUIRY"
    },
    {
        "id": "250311081860403-01",
        "title": "吸纳重点群体就业认定证明",
        "content": "企业经办人在广东公共就业服务云平台申报吸纳脱贫人口和困难群体就业岗位社保补贴认定证明，系统审批进度一直卡在初审，要求劳动就业局加快办理。",
        "expected_cat": "labor_social",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250312008540111-01",
        "title": "反映消防安全问题",
        "content": "市民举报杏坛镇南朗工业区3路9号厂房，该企业将主要疏散通道与安全出口用铁皮擅自封堵作为临时原料仓库，存在严重火灾群死群伤隐患，请消防大队严查。",
        "expected_cat": "public_safety",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250317141680109-01",
        "title": "居住权登记问题",
        "content": "市民反映其商品房已抵押给银行，目前打算在不动产登记中心为老人办理无偿居住权确权登记，咨询民法典下已抵押不动产设立居住权的登记要件。",
        "expected_cat": "social_governance",
        "expected_intent": "INQUIRY"
    },
    {
        "id": "250325147260105-01",
        "title": "（城管）违建问题",
        "content": "市民反映杏坛镇齐新路加油站前方红绿灯直走50米处，有人占用公路建筑控制区擅自浇筑地坪违规搭建彩钢板房大棚，涉嫌违法建设，要求城管拆除。",
        "expected_cat": "urban_management",
        "expected_intent": "COMPLAINT"
    },
    {
        "id": "250327006830407-01",
        "title": "【小程序自助】公墓能否有烈士碑",
        "content": "市民致电民政局和退役军人事务部门，询问当地公墓管理处是否设有烈士纪念设施与烈士墓区，清明节期间退役军人事务局是否有组织集体代祭扫安排。",
        "expected_cat": "social_governance",
        "expected_intent": "INQUIRY"
    },
    {
        "id": "250328059630102-01",
        "title": "网购热水器问题",
        "content": "厂家：广东万家乐燃气具有限公司，注册地址：广东省佛山市顺德区大良街道居委会逢沙路。市民购买的燃气热水器主板烧损，售后服务站推诿属于人为损坏不予保修，要求市监局消委会介入调解退费换新。",
        "expected_cat": "market_reg",
        "expected_intent": "COMPLAINT"
    }
]

def main():
    print(f"\n=========================================================================================")
    print(f"🎯 Regression Test: 14 Historical Misclassified Hard Cases (V2 vs V3 Head-to-Head)")
    print(f"=========================================================================================")
    
    tokenizer_v2 = FastCivicTokenizer(VOCAB_PATH, max_seq_len=128)
    tokenizer_v3 = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)
    
    sess_v2 = ort.InferenceSession(ONNX_V2_PATH, providers=["CPUExecutionProvider"])
    sess_v3 = ort.InferenceSession(ONNX_V3_PATH, providers=["CPUExecutionProvider"])
    
    cat_keys = CRITERIA_CHOICES["category"]
    
    v2_passed = 0
    v3_passed = 0
    total = len(TEST_CASES)

    print(f"{'No.':<3} | {'Ticket ID':<20} | {'Expected Cat':<15} | {'V2 Cat':<15} | {'V3 Cat':<15} | {'V3 Status'}")
    print("-" * 88)

    for i, c in enumerate(TEST_CASES):
        # 1. V2 Inference
        full_text = f"{c['title']}。{c['content']}"
        tokens_v2 = tokenizer_v2.encode(full_text)
        inp_v2 = np.zeros((1, 128), dtype=np.int64)
        mask_v2 = np.zeros((1, 128), dtype=np.float32)
        n2 = min(len(tokens_v2), 128)
        inp_v2[0, :n2] = tokens_v2[:n2]
        mask_v2[0, :n2] = 1.0
        outs_v2 = sess_v2.run(None, {"input_ids": inp_v2, "attention_mask": mask_v2})
        pred_cat_v2 = cat_keys[np.argmax(outs_v2[1], axis=-1)[0]]

        # 2. V3 Inference
        t_tokens, b_tokens = tokenizer_v3.encode(c["title"], c["content"])
        t_ids = np.zeros((1, 32), dtype=np.int64)
        t_mask = np.zeros((1, 32), dtype=np.float32)
        nt = min(len(t_tokens), 32)
        t_ids[0, :nt] = t_tokens[:nt]
        t_mask[0, :nt] = 1.0

        b_ids = np.zeros((1, 128), dtype=np.int64)
        b_mask = np.zeros((1, 128), dtype=np.float32)
        nb = min(len(b_tokens), 128)
        b_ids[0, :nb] = b_tokens[:nb]
        b_mask[0, :nb] = 1.0

        outs_v3 = sess_v3.run(None, {
            "title_ids": t_ids,
            "title_mask": t_mask,
            "body_ids": b_ids,
            "body_mask": b_mask
        })
        pred_cat_v3 = cat_keys[np.argmax(outs_v3[1], axis=-1)[0]]

        v2_ok = (pred_cat_v2 == c["expected_cat"])
        v3_ok = (pred_cat_v3 == c["expected_cat"])
        if v2_ok:
            v2_passed += 1
        if v3_ok:
            v3_passed += 1

        status_str = "✅ PASS" if v3_ok else "❌ FAIL"
        if not v2_ok and v3_ok:
            status_str = "🎉 REPAIRED"

        print(f"{i+1:<3} | {c['id']:<20} | {c['expected_cat']:<15} | {pred_cat_v2:<15} | {pred_cat_v3:<15} | {status_str}")

    print("-" * 88)
    print(f"📊 Summary:")
    print(f"   V2 Baseline Pass Rate: {v2_passed}/{total} ({v2_passed/total*100:.1f}%)")
    print(f"   V3 Dual-Stream Pass Rate: {v3_passed}/{total} ({v3_passed/total*100:.1f}%)")
    if v3_passed == total:
        print("🏆 ALL 14 HISTORICAL BLINDSPOTS 100% REPAIRED!")
    else:
        print(f"⚠️ {total - v3_passed} cases need attention.")

if __name__ == "__main__":
    main()
