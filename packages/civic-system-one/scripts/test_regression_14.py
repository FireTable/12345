#!/usr/bin/env python3
"""
Regression Test on 14 Historical Misclassified Civic Tickets (V4 Engine)
========================================================================
Tests V4 model on the 14 cases that were historically misclassified by V1:
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
import onnxruntime as ort
import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(SCRIPT_DIR)
from train import DualStreamCivicTokenizer, CRITERIA_CHOICES

VOCAB_PATH = os.path.join(SCRIPT_DIR, "../models/vocab_civic.json")
ONNX_PATH = os.path.join(SCRIPT_DIR, "../models/civic-laya-onnx/model.onnx")

TEST_CASES = [
    {
        "id": "250122128360109-01",
        "title": "购买沙发",
        "content": "市民反映其在2024年11月13日于顺德区龙江镇325国道龙江段70号豪柏工业区B栋二楼豪特莱定制家具购买沙发，付款5000元，商家承诺30天内发货，但至今仍未发货，多次联系商家推脱，现要求退款。",
        "expected_cat": "market_reg"
    },
    {
        "id": "250124067650109-01",
        "title": "公司注册问题",
        "content": "市民反映其办理佛山市顺德区乐从镇某某商贸有限公司注册，在一网通办平台提交资料，多次被驳回，提示经营范围表述不规范，市民咨询具体修改指引与市监局窗口咨询电话。",
        "expected_cat": "market_reg"
    },
    {
        "id": "250207030510109-01",
        "title": "机动车登记",
        "content": "市民咨询新购买的小型汽车办理注册登记，车管所预约已满，咨询是否可以异地办理免检车申领检验标志，以及顺德车管所周六是否提供延时服务。",
        "expected_cat": "traffic"
    },
    {
        "id": "250212127990102-01",
        "title": "网购纠纷",
        "content": "市民在京东平台购买顺德容桂某电器厂生产的热水器，收货后发现通电不加热，联系售后上门检测确认为主板故障，但厂家拒绝履行七天无理由退货协议，市民要求介入调解退货退款。",
        "expected_cat": "market_reg"
    },
    {
        "id": "250220121880109-01",
        "title": "外资企业变更",
        "content": "市民反映其所属的外商投资企业拟变更法定代表人及经营期限，在大良行政服务中心市监窗口办理时，告知需补充公证认证文件，现咨询有关外资认证具体细则。",
        "expected_cat": "market_reg"
    },
    {
        "id": "250303154580109-01",
        "title": "羽毛球馆消防问题",
        "content": "市民反映北滘镇某羽毛球馆将室内应急疏散通道锁闭，且唯一的消防安全出口堆满废弃球网和纸箱，存在重大火灾隐患，一旦发生险情人员无法逃生，要求消防部门速查。",
        "expected_cat": "public_safety"
    },
    {
        "id": "250304070060109-01",
        "title": "（城管）游商占道经营",
        "content": "市民反映陈村镇旧圩农贸市场正门周边，每天清晨5点至8点有大量流动菜贩和无牌三轮车占道乱摆卖，严重堵塞早高峰交通，垃圾遍地，要求城管执法局加强巡查取缔。",
        "expected_cat": "urban_management"
    },
    {
        "id": "250310047990109-01",
        "title": "失业金领取期限核查",
        "content": "市民此前在容桂某机械厂参保8年，2025年1月非因本人意愿中断就业，现申请领取失业保险金，社保系统显示可核定月数为12个月，市民咨询核定计算规则是否有误，要求社保经办机构复核。",
        "expected_cat": "labor_social"
    },
    {
        "id": "250311081860403-01",
        "title": "重点群体就业认定证明",
        "content": "市民为2024届离校未就业高校毕业生，持有顺德户籍，现向伦教街道公共服务办申请重点群体就业创业税收优惠认定证明，咨询办理窗口与所需提交的离校证明材料。",
        "expected_cat": "labor_social"
    },
    {
        "id": "250312008540111-01",
        "title": "工业区消防安全隐患",
        "content": "市民反映杏坛镇麦村工业区某五金喷涂作坊，私自搭建铁皮棚违规存放大量二甲苯稀释剂与易燃油漆桶，无任何防爆设施，无灭火器材，紧邻员工宿舍，存在重大爆炸与火灾危险。",
        "expected_cat": "public_safety"
    },
    {
        "id": "250317141680109-01",
        "title": "商品房居住权登记",
        "content": "市民咨询在顺德区不动产登记中心大良分中心办理商品房居住权无偿设立登记的程序，房屋已设立抵押，咨询是否需要抵押权人出具书面同意书。",
        "expected_cat": "social_governance"
    },
    {
        "id": "250325147260105-01",
        "title": "（城管）违建问题",
        "content": "市民反映乐从镇水藤村某民房楼顶，房东近期私自加建两层钢结构铁皮违章建筑，施工时常有碎砖掉落，无任何报建手续，要求城管拆违办依法核查拆除。",
        "expected_cat": "urban_management"
    },
    {
        "id": "250327006830407-01",
        "title": "公墓烈士碑代祭扫",
        "content": "市民为异地居住烈士家属，因年事已高行动不便，咨询顺德区飞鹅永久墓园2025年清明期间是否提供烈士纪念碑鲜花代祭扫及擦拭墓碑公益服务，由民政部门哪个科室承办。",
        "expected_cat": "social_governance"
    },
    {
        "id": "250328059630102-01",
        "title": "网购热水器万家乐售后纠纷",
        "content": "市民在天猫万家乐官方旗舰店购买燃气热水器，安装师傅上门强制收取高额不合理排气管辅材费280元，市民拒付后师傅拒绝调试通水，市民投诉乱收费并要求退还工时费。",
        "expected_cat": "market_reg"
    }
]

def main():
    print(f"🚀 Initializing V4 Cross-Attention Regression Test (14 Cases)...")
    tokenizer = DualStreamCivicTokenizer(VOCAB_PATH, max_title_len=32, max_body_len=128)
    sess = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])
    cat_keys = CRITERIA_CHOICES["category"]
    
    passed = 0
    total = len(TEST_CASES)

    print(f"{'No.':<3} | {'Ticket ID':<20} | {'Expected Cat':<15} | {'V4 Predicted':<15} | {'Status'}")
    print("-" * 75)

    for i, c in enumerate(TEST_CASES):
        t_tokens, b_tokens = tokenizer.encode(c["title"], c["content"])
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

        outs = sess.run(None, {
            "title_ids": t_ids,
            "title_mask": t_mask,
            "body_ids": b_ids,
            "body_mask": b_mask
        })
        # outs: [category_logits, intent_logits, urgency_logits, stability_logits]
        pred_cat = cat_keys[np.argmax(outs[0], axis=-1)[0]]

        is_ok = (pred_cat == c["expected_cat"])
        if is_ok:
            passed += 1

        status_str = "✅ PASS" if is_ok else "❌ FAIL"
        print(f"{i+1:<3} | {c['id']:<20} | {c['expected_cat']:<15} | {pred_cat:<15} | {status_str}")

    print("-" * 75)
    print(f"📊 Summary: V4 Pass Rate: {passed}/{total} ({passed/total*100:.1f}%)")
    if passed == total:
        print("🏆 ALL 14 HISTORICAL REGRESSION CASES 100% PASSED!")

if __name__ == "__main__":
    main()
