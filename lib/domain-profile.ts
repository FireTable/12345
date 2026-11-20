import { eq } from "drizzle-orm";
import { db, getRegionDb } from "@/db/client";
import { regionsTable } from "@/db/schema";

export type DomainType = "GOV_12345" | "ECOMMERCE_CS";

export interface DomainTerminology {
  regionUnit: string;
  subject: string;
  ticketNoun: string;
  ownerNoun: string;
  themeNoun: string;
  fakeClosureLabel: string;
}

export interface DomainProfile {
  domainType: DomainType;
  displayName: string;
  badgeLabel: string;
  hasGeoMap: boolean;
  categories: string[];
  channels: string[];
  terminology: DomainTerminology;
  promptPersona: string;
}

export const GOV_12345_PROFILE: DomainProfile = {
  domainType: "GOV_12345",
  displayName: "12345 政务服务热线",
  badgeLabel: "政务热线",
  hasGeoMap: true,
  categories: [
    "城市管理",
    "市场监管",
    "社会治理",
    "交通出行",
    "生态环境",
    "劳动社保",
    "公共安全",
  ],
  channels: ["市民服务热线", "政务微信", "12345网站", "粤省事小程序"],
  terminology: {
    regionUnit: "所属镇街",
    subject: "涉事主体",
    ticketNoun: "民生工单",
    ownerNoun: "牵头部门",
    themeNoun: "多频研判专题",
    fakeClosureLabel: "疑似假闭环",
  },
  promptPersona: "你是政务热线智能工单要素抽取专家",
};

export const ECOMMERCE_CS_PROFILE: DomainProfile = {
  domainType: "ECOMMERCE_CS",
  displayName: "电商售后客诉中心",
  badgeLabel: "电商客诉",
  hasGeoMap: false,
  categories: [
    "商品质量与破损",
    "物流延误与丢件",
    "货不对板与宣传不符",
    "退款与价保纠纷",
    "假冒伪劣与欺诈",
    "客服推诿与售后超时",
    "食安与合规红线",
  ],
  channels: [
    "天猫旗舰店",
    "抖音直播间",
    "京东自营店",
    "拼多多官方店",
    "华南冷链仓",
    "华东中心仓",
    "华北分拨仓",
    "跨境保税仓",
  ],
  terminology: {
    regionUnit: "渠道/仓网",
    subject: "涉事SKU/店铺/承运商",
    ticketNoun: "客诉工单",
    ownerNoun: "责任团队",
    themeNoun: "多频客诉案卷",
    fakeClosureLabel: "售后假闭环",
  },
  promptPersona: "你是电商售后全渠道智能客诉研判专家",
};

function mergeDomainProfile(
  base: DomainProfile,
  override: Partial<DomainProfile>
): DomainProfile {
  return {
    domainType: override.domainType === "ECOMMERCE_CS" ? "ECOMMERCE_CS" : base.domainType,
    displayName: typeof override.displayName === "string" && override.displayName.trim()
      ? override.displayName.trim()
      : base.displayName,
    badgeLabel: typeof override.badgeLabel === "string" && override.badgeLabel.trim()
      ? override.badgeLabel.trim()
      : base.badgeLabel,
    hasGeoMap: typeof override.hasGeoMap === "boolean" ? override.hasGeoMap : base.hasGeoMap,
    categories: Array.isArray(override.categories) && override.categories.length > 0
      ? override.categories.map(String)
      : base.categories,
    channels: Array.isArray(override.channels) && override.channels.length > 0
      ? override.channels.map(String)
      : base.channels,
    terminology: {
      ...base.terminology,
      ...(override.terminology && typeof override.terminology === "object"
        ? override.terminology
        : {}),
    },
    promptPersona: typeof override.promptPersona === "string" && override.promptPersona.trim()
      ? override.promptPersona.trim()
      : base.promptPersona,
  };
}

/**
 * 解析 regions.category_config_json 中的 DomainProfile，缺省或异常时安全回退 GOV_12345_PROFILE。
 */
export function parseDomainProfile(categoryConfigJson?: string | null): DomainProfile {
  if (!categoryConfigJson || typeof categoryConfigJson !== "string") {
    return GOV_12345_PROFILE;
  }
  try {
    const parsed = JSON.parse(categoryConfigJson) as {
      domainProfile?: Partial<DomainProfile>;
      domainType?: string;
    } | null;
    if (!parsed || typeof parsed !== "object") {
      return GOV_12345_PROFILE;
    }
    const candidate = (parsed.domainProfile && typeof parsed.domainProfile === "object"
      ? parsed.domainProfile
      : parsed) as Partial<DomainProfile>;

    if (candidate.domainType === "ECOMMERCE_CS") {
      return mergeDomainProfile(ECOMMERCE_CS_PROFILE, candidate);
    }
    if (candidate.domainType === "GOV_12345") {
      return mergeDomainProfile(GOV_12345_PROFILE, candidate);
    }
    return GOV_12345_PROFILE;
  } catch {
    return GOV_12345_PROFILE;
  }
}

/**
 * 读取指定租户的 DomainProfile，未配置或出错一律安全回退 GOV_12345_PROFILE。
 */
export async function getRegionDomainProfile(regionId?: string | null): Promise<DomainProfile> {
  try {
    const { region } = await getRegionDb(regionId);
    if (region?.categoryConfigJson) {
      return parseDomainProfile(region.categoryConfigJson);
    }
    if (regionId?.trim()) {
      const [row] = await db
        .select({ categoryConfigJson: regionsTable.categoryConfigJson })
        .from(regionsTable)
        .where(eq(regionsTable.id, regionId.trim()))
        .limit(1);
      if (row?.categoryConfigJson) {
        return parseDomainProfile(row.categoryConfigJson);
      }
    }
  } catch {
    // 回退政务默认配置
  }
  return GOV_12345_PROFILE;
}
