#!/usr/bin/env python3
"""
@civic/system-one: Build Universal Chinese Civic Vocabulary (15,000 Vocab)
=========================================================================
Extracts clean, universal Chinese civic terms, common characters, and high-frequency
n-grams while filtering out localized town names to ensure nationwide 12345 compatibility.
"""

import os
import sys
import re
import json
from collections import Counter

DATASET_PATH = os.path.join(os.path.dirname(__file__), "../data/civic_train.jsonl")
OUTPUT_VOCAB_PATH = os.path.join(os.path.dirname(__file__), "../models/vocab_civic.json")

# 1. 全国通用 12345 核心法定实体与高频动宾短语词库 (严格去属地化)
CORE_CIVIC_DICTIONARY = [
    # 劳动社保与医保
    "欠薪", "拖欠工资", "克扣工资", "年底结薪", "未签劳动合同", "双倍工资", "经济补偿金", "无故辞退",
    "试用期陷阱", "劳务派遣", "包工头跑路", "工伤认定", "劳动能力鉴定", "伤残津贴", "工伤复发", "职业病",
    "失业保险金", "失业金", "养老金核定", "职工养老保险", "灵活就业社保", "断缴补缴", "社保转移", "退休证",
    "丧葬抚恤金", "死亡待遇", "一次性趸缴", "医保个账", "异地就医结算", "医保报销", "门诊慢特病", "生育津贴",
    "产假", "陪产假", "医保等待期", "工伤私了", "高空作业坠落", "最低工资标准", "劳动监察大队", "劳动争议仲裁",
    
    # 市场监督管理与消费维权
    "退款", "退费", "虚假宣传", "价格欺诈", "霸王条款", "未明码标价", "缺斤短两", "强制消费", "定金不退",
    "捆绑销售", "会员卡暴雷", "预付卡跑路", "以次充好", "假冒伪劣", "翻新机", "三包售后", "开箱破损",
    "质量缺陷", "甲醛超标", "过期食品", "变质发霉", "异物吃出", "三无产品", "农药残留", "无证小作坊",
    "保健品欺诈", "假药劣药", "营业执照", "个体户注销", "个体户设立", "一网通办", "股东变更", "电梯困人",
    "特种设备年检", "不正当竞争", "买卖合同", "拒绝履约", "假一赔三", "虚假发货", "消费欺诈", "消协调解",
    
    # 生态环境与污染防治
    "工业废气", "偷排污水", "恶臭异味", "黑臭水体", "烟囱黑烟", "有毒溶剂", "危废倾倒", "商业高音喇叭",
    "酒吧低音炮", "KTV隔音", "餐饮油烟直排", "油烟净化器", "夜市烧烤", "冷却塔噪音", "夜间超时施工",
    "深夜打桩", "渣土车轰鸣", "无夜间施工许可", "铁板颠簸巨响", "扬尘污染", "环境恶臭", "化学刺鼻异味",
    "社会生活噪声", "广场舞扰民", "噪声污染防治法", "低频噪音", "油烟扰民", "排污许可证", "黑烟滚滚",
    
    # 城市管理与综合执法
    "违建", "擅自搭棚", "占用公共绿地", "楼顶加层", "开挖地下室", "破坏承重墙", "彩钢瓦板房", "占道经营",
    "无证流动摊贩", "乱摆乱卖", "乱堆乱放", "地面积水", "下水道堵塞", "污水反涌", "井盖破损", "井盖缺失",
    "路面破损", "坑洼不平", "路灯不亮", "垃圾堆积", "垃圾未分类", "卫生死角", "树木遮挡采光", "物业不作为",
    "擅自涨停车费", "公共设施破损", "乱扔垃圾", "流动摊点", "违章建筑物", "违法建设", "市容市貌", "绿化管养",
    
    # 交通运输与交警管理
    "乱停乱放", "违章停车", "占用盲道", "占用消防通道", "车辆逆行", "闯红灯", "酒驾飙车", "非法改装",
    "公交改道", "班次延误", "出租车拒载", "拒不打表", "网约车拼车", "交通信号灯故障", "红绿灯失灵",
    "减速带损坏", "标志标线模糊", "道路施工拥堵", "车管所", "机动车号牌", "年审免检", "驾驶证期满换证",
    "违章扣分申诉", "电动自行车上牌", "违章变道", "超载超速", "乱占车道", "僵尸车", "私装地锁",
    
    # 公共安全与应急救援
    "封堵安全出口", "锁闭疏散通道", "消防栓无水", "灭火器失效", "飞线充电", "电动车进楼入户", "危化品私存",
    "违规燃放烟花", "打架斗殴", "涉黄涉赌", "电信网络诈骗", "高空抛物", "恶犬伤人", "危房险情", "山体滑坡",
    "暴雨内涝", "堤坝决口", "火灾隐患", "爆炸危险", "煤气泄漏", "天然气闪爆", "坍塌事故", "溺水危险",
    
    # 综合社会治理与基层民生
    "无犯罪记录证明", "户口迁移", "居住证办理", "不动产确权", "居住权登记", "邻里纠纷", "加装电梯",
    "低保救助", "残疾人补贴", "残疾证评定", "孤儿抚养", "烈士纪念碑", "公墓殡葬服务", "婚姻登记预约",
    "政务大厅", "窗口服务态度", "办事推诿", "村务公开", "居务公开", "社区网格员", "便民服务",
    
    # 诉求意图与紧急度红线
    "咨询", "如何办理", "申请流程", "需要材料", "政策依据", "投诉", "强烈要求", "依法查处", "严厉打击",
    "建议", "提议", "希望优化", "建议增设", "催办", "再次反映", "逾期未结", "进度停滞", "表扬", "尽职尽责",
    "跳楼", "自杀", "割腕", "不想活了", "死给你们看", "同归于尽", "拉横幅", "聚众堵路", "集体上访", "报复社会"
]

# 需过滤的特定局部地域名字库 (确保词表绝对通用)
LOCAL_TERMS_TO_FILTER = {
    "大良", "容桂", "伦教", "勒流", "陈村", "北滘", "乐从", "龙江", "杏坛", "均安",
    "顺德", "佛山", "南海", "禅城", "三水", "高明", "广州", "深圳", "东莞", "中山",
    "华侨城", "嘉信", "清樾", "德富路", "南国路", "碧桂园", "新城之光"
}


def build_vocab(target_size: int = 15000):
    print(f"📦 Extracting vocabulary from {DATASET_PATH}...")
    
    # 基础特殊符号
    special_tokens = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]
    vocab = list(special_tokens)
    vocab_set = set(vocab)

    # 1. 注入核心法定词典
    for word in CORE_CIVIC_DICTIONARY:
        if word not in vocab_set:
            vocab.append(word)
            vocab_set.add(word)
    print(f"✅ Injected {len(CORE_CIVIC_DICTIONARY)} core statutory civic terms.")

    # 2. 统计训练集中的单字与常用 2-gram / 3-gram
    char_counter = Counter()
    ngram_counter = Counter()

    count = 0
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        for line in f:
            count += 1
            data = json.loads(line)
            text = data["state"]
            # 过滤特殊占位符与标点
            clean_text = re.sub(r"\{\{.*?\}\}|[^\u4e00-\u9fa5a-zA-Z0-9]", " ", text)
            words = clean_text.split()
            
            for w in words:
                # 统计单字
                for c in w:
                    char_counter[c] += 1
                # 统计 2-gram
                for i in range(len(w) - 1):
                    ngram = w[i:i+2]
                    if len(ngram) == 2 and not any(loc in ngram for loc in LOCAL_TERMS_TO_FILTER):
                        ngram_counter[ngram] += 1
                # 统计 3-gram
                for i in range(len(w) - 2):
                    ngram = w[i:i+3]
                    if len(ngram) == 3 and not any(loc in ngram for loc in LOCAL_TERMS_TO_FILTER):
                        ngram_counter[ngram] += 1

            if count >= 60000: # 采样 6 万条数据提炼最核心词，效率与覆盖兼备
                break

    print(f"📊 Processed {count:,} samples. Total unique chars: {len(char_counter)}, n-grams: {len(ngram_counter)}")

    # 3. 注入高频单字 (前 3,500 常用字)
    for c, freq in char_counter.most_common(3500):
        if c not in vocab_set:
            vocab.append(c)
            vocab_set.add(c)
    print(f"✅ Injected top common Chinese characters. Current vocab size: {len(vocab)}")

    # 4. 注入最高频政务 N-gram 词，填充至 target_size
    remaining = target_size - len(vocab)
    for ngram, freq in ngram_counter.most_common(remaining * 2):
        if freq < 10:
            break
        if ngram not in vocab_set:
            vocab.append(ngram)
            vocab_set.add(ngram)
            if len(vocab) >= target_size:
                break

    print(f"🎉 Final Vocabulary Size: {len(vocab):,} terms!")

    # 5. 保存词表为 JSON
    os.makedirs(os.path.dirname(OUTPUT_VOCAB_PATH), exist_ok=True)
    vocab_dict = {
        "vocab_size": len(vocab),
        "tokens": vocab,
        "token_to_id": {t: idx for idx, t in enumerate(vocab)}
    }
    with open(OUTPUT_VOCAB_PATH, "w", encoding="utf-8") as f:
        json.dump(vocab_dict, f, ensure_ascii=False, indent=2)

    print(f"💾 Universal Civic Vocab saved to: {OUTPUT_VOCAB_PATH}")
    return vocab_dict

if __name__ == "__main__":
    build_vocab(target_size=15000)
