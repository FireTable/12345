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

const NON_PERSON_NAME_RE =
  /(?:反映|表示|投诉|咨询|询问|核实|处理|解决|沟通|协调|强烈|全部|全体|全额|全面|方面|经过|通过|多次|多日|常年|长期|昨日|昨天|今日|今天|昨晚|上月|上周|去年|今年|近日|日前|周末|周[一二三四五六日末]|马上|立即|单独|白天|能否|高声|冷静|周边|周围|单身|老年|年轻|成年|物业|车辆|车位|车主|房屋|家里|家中|家人|家属|水电|水表|管道|空调|热线|部门|单位|公司|商家|商户|小区|门口|路段|现场|情况|问题|意见|建议|要求|诉求|委员会|人员|代表)/;

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
  // 2. 中国机动车号牌 (含新能源、分隔符 ·•・- 空格、以及挂学警港澳特种后缀)
  {
    category: "LICENSE_PLATE",
    pattern: /[粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Z][·•・\- ]?(?:[A-Z0-9]{4,5}[挂学警港澳]|[A-Z0-9]{5,6})(?![A-Z0-9挂学警港澳])/g,
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
  // 严格杜绝误伤"全部业主/广大业主/满足投诉人/市民反映/业主委员会"等泛化群体称谓，仅识别自然人真名
  {
    category: "PERSON_NAME",
    pattern: new RegExp(
      `(?!(?:公司|公关|那位|这位|哪位|各位|某位)(?:先生|女士|小姐))(?<!(?:我|贵|本|该|公)(?=司)|千(?=金小姐)|对(?=方小姐))([${SURNAME_PREFIX}][一-龥]{0,2}?)(?:先生|女士|小姐)|` +
      `(?<=(?:市民|当事人|诉求人|业主|投诉人|反映人|来电人|举报人|其朋友|其家公|其父|其母|其妻|其夫)[（(])([${SURNAME_PREFIX}][一-龥]{1,3})(?=[，,、\\s）)；;]|身份证)|` +
      `(?<=(?:市民|当事人|诉求人|业主|投诉人|反映人|来电人|举报人)[：:\\s]*)([${SURNAME_PREFIX}][一-龥]{1,2}?)(?=[，,。、\\s）)；;：:(（]|的|在|于|向|对|与|和|因|从|到|去|已|曾|未|还|也|就|却|并|称|说|反映|表示|来电|致电|投诉|咨询|举报|提供|询问|要求|希望|请求|核实|联系|手机|电话|身份证|家|驾驶|骑行|乘坐|搭乘|$)|` +
      `(?<=(?:法定代表人|老板|单位负责人|负责人|联系人)[：:\\s]+)([${SURNAME_PREFIX}][一-龥]{1,3}?)(?=[，,。、\\s）)；;]|电话|手机|职务|$)|` +
      `(?<=(?:叫|名为|名字叫|姓名是)\\s*)([${SURNAME_PREFIX}][一-龥]{1,2}?)(?=[，,。、\\s的]|$)|` +
      `(?<=其朋友[（(])([一-龥]{2,4})(?=[)）])`,
      "g"
    ),
    validator: (val: string) => !NON_PERSON_NAME_RE.test(val),
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
