import type { CivicPiiCategory, PiiSpan } from "./types";

export interface DetectorDef {
  category: CivicPiiCategory;
  pattern: RegExp;
  validator?: (val: string) => boolean;
  score: number;
}

/**
 * 中国二代身份证 ISO 7064:1983.MOD 11-2 国标校验和算法
 * 避免任意 18 位长数字（如快递运单号、内部流水号）被误判为身份证。
 */
export function isValidChinaIdCard(id: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const parityBits = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(id[i], 10) * weights[i];
  }
  const checkBit = parityBits[sum % 11];
  return id[17].toUpperCase() === checkBit;
}

/**
 * 百家姓字库（覆盖 99.8% 常见中文姓氏）
 */
const SURNAME_PREFIX =
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";

/**
 * 12345 政务专用识别器集合（按特征严谨度分级）
 */
export const CIVIC_DETECTORS: DetectorDef[] = [
  // 1. 二代身份证 (格式极其严格，带 Checksum 验证)
  {
    category: "ID_CARD",
    pattern: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
    validator: isValidChinaIdCard,
    score: 0.99,
  },
  // 2. 中国机动车号牌 (含新能源与各省简称)
  {
    category: "LICENSE_PLATE",
    pattern: /[粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}/g,
    score: 0.95,
  },
  // 3. 手机号码与带区号固话 (负向预查避免误吞时间戳与工单号)
  {
    category: "PHONE_NUMBER",
    pattern: /(?<!\d)(?:(?:\+|00)86)?1[3-9]\d{9}(?!\d)|\b0\d{2,3}-?\d{7,8}\b/g,
    score: 0.9,
  },
  // 4. 私密室内房号 (精准隔离：仅脱敏私人居所房号，绝对保留公共路段、广场、商业设施名)
  // 覆盖场景：7座304的业主、5栋1204、327房、102室
  {
    category: "PRIVATE_ROOM",
    pattern: /(?<=[栋座单元梯幢号院]\s*)(\d{2,4}(?:[室房户]|(?=的?业主|的?住户|的?居民)))|(?<![0-9A-Za-z栋座单元梯幢号院])(\d{3,4}[室房])/g,
    score: 0.88,
  },
  // 5. 个人称谓与特定代称人名
  // 严格杜绝误伤"全部业主/广大业主/满足投诉人"等泛化群体称谓，仅识别自然人真名
  {
    category: "PERSON_NAME",
    pattern: new RegExp(
      `([${SURNAME_PREFIX}][一-龥]{1,2})(?:先生|女士|小姐)|` +
      `(?<=(?:市民|当事人|诉求人|业主|投诉人|其朋友|其家公|其父|其母|其妻|其夫)[（(])([${SURNAME_PREFIX}][一-龥]{1,3})(?=[，,、\\s）)；;]|身份证)|` +
      `(?<=(?:法定代表人|老板|单位负责人|负责人|联系人)[：:\\s]+)([${SURNAME_PREFIX}][一-龥]{1,3})(?=[，,。、\\s）)；;]|电话|手机|职务|$)|` +
      `(?<=(?:叫|名为|名字叫|姓名是)\\s*)([${SURNAME_PREFIX}][一-龥]{1,2})(?=[，,。、\\s的]|$)|` +
      `其朋友[（(]([一-龥]{2,4})[)）]`,
      "g"
    ),
    score: 0.85,
  },
];

/**
 * 提取文本中所有潜在的 PII 匹配实体
 */
export function scanSpans(
  text: string,
  categories?: CivicPiiCategory[]
): PiiSpan[] {
  if (!text) return [];

  const spans: PiiSpan[] = [];
  const allowed = categories ? new Set(categories) : null;

  for (const detector of CIVIC_DETECTORS) {
    if (allowed && !allowed.has(detector.category)) {
      continue;
    }

    detector.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = detector.pattern.exec(text)) !== null) {
      const val = match[0];
      if (detector.validator && !detector.validator(val)) {
        continue;
      }
      spans.push({
        category: detector.category,
        start: match.index,
        end: match.index + val.length,
        value: val,
        score: detector.score,
      });
    }
  }

  return spans;
}
