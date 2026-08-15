/**
 * 出站脱敏：只打个人隐私，保留办单/聚类所需业务要素。
 *
 * 工作人员读 tickets.content（原文永不覆盖）。
 * 云端模型只读 tickets.masked_content，或经 ticketBodyForAI() 现场生成。
 *
 * 打码：手机、固话、身份证、邮箱、称谓姓名。
 * 不打：车牌、店名、路名、镇街、门牌/房号。
 */

export interface DesensitizeOptions {
  maskPhone?: boolean;
  maskIdCard?: boolean;
  maskEmail?: boolean;
  maskName?: boolean;
}

const DEFAULT_OPTIONS: DesensitizeOptions = {
  maskPhone: true,
  maskIdCard: true,
  maskEmail: true,
  maskName: true,
};

const SURNAME =
  "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公";

const NAME_TITLE = "先生|女士|小姐|业主";

export function desensitizeContent(
  content: string,
  options: DesensitizeOptions = DEFAULT_OPTIONS
): string {
  if (!content || typeof content !== "string") return "";

  let text = content;

  // 先打证件号，避免 18 位身份证中间被手机号规则截走
  if (options.maskIdCard !== false) {
    text = text.replace(
      /(?<!\d)([1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?!\d)/g,
      (m) => `${m.slice(0, 6)}********${m.slice(14)}`
    );
    text = text.replace(
      /(?<!\d)([1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3})(?!\d)/g,
      (m) => {
        if (m.length !== 15) return m;
        return `${m.slice(0, 6)}*****${m.slice(11)}`;
      }
    );
  }

  if (options.maskPhone !== false) {
    text = text.replace(/(?<!\d)(?:(?:\+|00)86)?1[3-9]\d{9}(?!\d)/g, (m) => {
      const n = m.replace(/^(?:\+|00)86/, "");
      return `${n.slice(0, 3)}****${n.slice(7)}`;
    });
    // 仅匹配带区号的固话，避免误伤工单号、时间戳
    text = text.replace(/(?<!\d)0\d{2,3}-?[2-8]\d{6,7}(?!\d)/g, (m) => {
      if (m.length < 8) return m;
      return `${m.slice(0, 4)}****${m.slice(-3)}`;
    });
  }

  if (options.maskEmail !== false) {
    text = text.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      (m) => {
        const [local, domain] = m.split("@");
        const keep = local.slice(0, 1);
        return `${keep}***@${domain}`;
      }
    );
  }

  if (options.maskName !== false) {
    const titled = new RegExp(`([${SURNAME}])(?:[一-龥]{1,2})?(?=${NAME_TITLE})`, "g");
    text = text.replace(titled, "$1*");

    text = text.replace(
      /(姓名|负责人|联系人)[：:]\s*([一-龥]{2,4})/g,
      "$1：*"
    );
    text = text.replace(/其朋友[（(]([一-龥]{2,4})[)）]/g, "其朋友（*）");
  }

  return text;
}

/** 模型出站正文：优先已落库脱敏列，缺省则现场打码。不改原文。 */
export function ticketBodyForAI(ticket: {
  content?: string | null;
  maskedContent?: string | null;
}): string {
  const stored = ticket.maskedContent;
  if (typeof stored === "string" && stored.length > 0) return stored;
  return desensitizeContent(ticket.content || "");
}
