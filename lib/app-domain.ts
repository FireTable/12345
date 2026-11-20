export type TenantDomainType = "GOV_12345" | "ECOMMERCE_CS";
export type AppDomainMode = TenantDomainType | "ALL";

/**
 * 读取当前运行进程激活的业务域开关 (APP_DOMAIN)。
 * 每次调用实时读取 process.env.APP_DOMAIN，保证同一份构建产物按运行环境变量切换：
 * - GOV_12345 (默认/未设置): 仅暴露 12345 政务热线站点，彻底隐藏电商客诉演示域
 * - ECOMMERCE_CS: 独立电商售后客诉站点，仅暴露电商客诉域
 * - ALL: 多业务域联合调试/测试模式
 */
export function getAppDomainMode(raw?: string | null): AppDomainMode {
  const source = raw ?? (typeof process !== "undefined" ? process.env.APP_DOMAIN : undefined) ?? "";
  const normalized = source.trim().toUpperCase();
  if (normalized === "ECOMMERCE_CS" || normalized === "ECOMMERCE" || normalized === "ECOM") {
    return "ECOMMERCE_CS";
  }
  if (normalized === "ALL" || normalized === "MULTI" || normalized === "*") {
    return "ALL";
  }
  return "GOV_12345";
}

/**
 * 轻量解析租户 categoryConfigJson 所属业务域，无数据库依赖，供路由隔离与元数据渲染共用。
 */
export function resolveRegionDomainType(categoryConfigJson?: string | null): TenantDomainType {
  if (!categoryConfigJson || typeof categoryConfigJson !== "string") {
    return "GOV_12345";
  }
  try {
    const parsed = JSON.parse(categoryConfigJson) as {
      domainProfile?: { domainType?: string };
      domainType?: string;
    } | null;
    const candidate = parsed?.domainProfile?.domainType || parsed?.domainType;
    if (candidate === "ECOMMERCE_CS") {
      return "ECOMMERCE_CS";
    }
  } catch {
    // 异常配置安全回退政务默认域
  }
  return "GOV_12345";
}

export function isDomainAllowed(
  domainType: TenantDomainType,
  mode: AppDomainMode = getAppDomainMode()
): boolean {
  if (mode === "ALL") return true;
  return domainType === mode;
}

export function isRegionAllowedInAppDomain(
  region: { categoryConfigJson?: string | null } | null | undefined,
  mode: AppDomainMode = getAppDomainMode()
): boolean {
  if (!region) return false;
  return isDomainAllowed(resolveRegionDomainType(region.categoryConfigJson), mode);
}

export function filterRegionsByAppDomain<T extends { categoryConfigJson?: string | null }>(
  regions: T[],
  mode: AppDomainMode = getAppDomainMode()
): T[] {
  if (mode === "ALL") return regions;
  return regions.filter((r) => isRegionAllowedInAppDomain(r, mode));
}

export function getFallbackRegionIdForDomain(mode: AppDomainMode = getAppDomainMode()): string {
  return mode === "ECOMMERCE_CS" ? "ecom_demo" : "gz_tianhe";
}
