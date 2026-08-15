/**
 * 政务热线全要素程序化脱敏引擎 (Air-gap Civic Data Desensitizer)
 * 
 * 设计原则：
 * 1. 业务保真隔离：数据库持久化保存原始真实数据供政务内网工作人员办单，同时保存脱敏数据供外部/AI使用；
 * 2. 边界合规：上送至任何外部云端大模型的 Prompt 均强制调用本模块进行动态打码；
 * 3. 语义保留：打码规则精准保留行政区划、问题特征、企业字号与车型特征，仅消除个人隐私要素。
 */

export interface DesensitizeOptions {
  maskPhone?: boolean;
  maskIdCard?: boolean;
  maskPlate?: boolean;
  maskName?: boolean;
  maskRoom?: boolean;
}

const DEFAULT_OPTIONS: DesensitizeOptions = {
  maskPhone: true,
  maskIdCard: true,
  maskPlate: true,
  maskName: true,
  maskRoom: true,
};

/**
 * 对单段诉求文本进行全要素脱敏
 */
export function desensitizeContent(
  content: string,
  options: DesensitizeOptions = DEFAULT_OPTIONS
): string {
  if (!content || typeof content !== "string") return "";

  let text = content;

  // 1. 手机号码脱敏（保留前3后4，如 13825789123 -> 138****9123）
  if (options.maskPhone !== false) {
    text = text.replace(/(?:(?:\+|00)86)?1[3-9]\d{9}/g, (m) => {
      return `${m.slice(0, 3)}****${m.slice(7)}`;
    });
    // 固话/座机脱敏（如 0757-22334455 -> 0757-****4455）
    text = text.replace(/\b(?:0\d{2,3}-?)?[2-8]\d{6,7}\b/g, (m) => {
      if (m.length >= 7) {
        return `${m.slice(0, 4)}****${m.slice(-3)}`;
      }
      return m;
    });
  }

  // 2. 18位二代身份证号脱敏（保留前6后4，如 440606199208151234 -> 440606********1234）
  if (options.maskIdCard !== false) {
    text = text.replace(
      /\b([1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])\b/g,
      (m) => `${m.slice(0, 6)}********${m.slice(14)}`
    );
  }

  // 3. 车牌号码脱敏（保留省份+市级代码+尾号，隐藏中间关键位，如 粤E SD221 -> 粤E S***1）
  if (options.maskPlate !== false) {
    text = text.replace(
      /([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Z][\s]?)([A-Z0-9]{4,6})/gi,
      (_, prefix, seq) => {
        const p = prefix.trim();
        const s = seq.trim();
        if (s.length >= 4) {
          return `${p} ${s.slice(0, 1)}***${s.slice(-1)}`;
        }
        return `${p} ***`;
      }
    );
  }

  // 4. 私密室内门牌号模糊化（保留小区/楼栋，隐藏具体房号，如 3栋502房 -> 3栋***室）
  if (options.maskRoom !== false) {
    text = text.replace(/(\d+栋|\d+座|\d+单元)?(\d{3,4}房|\d{3,4}室)/g, (_, b) => {
      return `${b || ""}***室`;
    });
  }

  // 5. 常见称谓/姓名模糊化（如 陈小明先生 -> 陈*先生，李女士 -> 李*士）
  if (options.maskName !== false) {
    text = text.replace(
      /([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公])([一-龥]{1,2})(?:先生|女士|小姐|市民|居民|业主|投诉人|诉求人)/g,
      "$1*$3"
    );
  }

  return text;
}
