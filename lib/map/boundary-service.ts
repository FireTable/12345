/**
 * 官方权威高精度行政区划边界 (GeoJSON) 服务
 * 
 * 1. 专注拉取区县级（第三级）权威审图号的法定行政边界矢量多边形（Polygon / MultiPolygon）；
 * 2. 数据来源于官方自然资源部/民政部权威审定测绘地理信息（阿里 DataV 审图号 GS(2024) 矢量服务）；
 * 3. 获取后持久化存储在站点管理中心 (public.regions 表中的 geojson_boundary 字段)；
 * 4. 彻底替代原本地精度不足、存在缝隙偏差的静态资产。
 */

// 常用重点城市区县行政区划代码字典（民政部标准 GB/T 2260）
export const KNOWN_DISTRICT_ADCODES: Record<string, number> = {
  // 佛山市
  "顺德区": 440606,
  "顺德": 440606,
  "禅城区": 440604,
  "禅城": 440604,
  "南海区": 440605,
  "南海": 440605,
  "三水区": 440607,
  "三水": 440607,
  "高明区": 440608,
  "高明": 440608,

  // 广州市
  "海珠区": 440105,
  "海珠": 440105,
  "天河区": 440106,
  "天河": 440106,
  "越秀区": 440104,
  "越秀": 440104,
  "荔湾区": 440103,
  "荔湾": 440103,
  "白云区": 440111,
  "白云": 440111,
  "黄埔区": 440112,
  "黄埔": 440112,
  "番禺区": 440113,
  "番禺": 440113,
  "花都区": 440114,
  "花都": 440114,
  "南沙区": 440115,
  "南沙": 440115,
  "从化区": 440117,
  "从化": 440117,
  "增城区": 440118,
  "增城": 440118,

  // 深圳市
  "福田区": 440304,
  "罗湖区": 440303,
  "南山区": 440305,
  "宝安区": 440306,
  "龙岗区": 440307,
  "盐田区": 440308,
  "龙华区": 440309,
  "坪山区": 440310,
  "光明区": 440311,

  // 珠海市
  "香洲区": 440402,
  "斗门区": 440403,
  "金湾区": 440404,

  // 江门市
  "蓬江区": 440703,
  "江海区": 440704,
  "新会区": 440705,
  "台山市": 440781,
  "开平市": 440783,
  "鹤山市": 440784,
  "恩平市": 440785,

  // 肇庆市
  "端州区": 441202,
  "鼎湖区": 441203,
  "高要区": 441204,

  // 惠州市
  "惠城区": 441302,
  "惠阳区": 441303,
  "博罗县": 441322,
  "惠东县": 441323,

  // 东莞市 / 中山市（地级市统筹）
  "东莞市": 441900,
  "中山市": 442000,
};

export type BoundaryFetchResult = {
  success: boolean;
  adcode?: number;
  name?: string;
  geojson?: any;
  pointCount?: number;
  center?: [number, number];
  centroid?: [number, number];
  error?: string;
};

/**
 * 根据地区名称或直接传入的 adcode 获取官方高精区县边界
 */
export async function fetchDistrictBoundary(
  districtName: string,
  cityName?: string,
  manualAdcode?: number
): Promise<BoundaryFetchResult> {
  let targetAdcode = manualAdcode;

  if (!targetAdcode) {
    const cleanName = districtName.trim();
    // 1. 先精准查表
    targetAdcode = KNOWN_DISTRICT_ADCODES[cleanName] || KNOWN_DISTRICT_ADCODES[cleanName.replace(/区|市|县$/, "")];

    // 2. 如果带城市前缀，尝试组合
    if (!targetAdcode && cityName) {
      const fullCombo = `${cityName}${cleanName}`;
      targetAdcode = KNOWN_DISTRICT_ADCODES[fullCombo];
    }
  }

  if (!targetAdcode) {
    return {
      success: false,
      error: `未能自动匹配「${cityName || ""}${districtName}」的国家行政区划代码 (adcode)，请指定 6 位数字代码`,
    };
  }

  try {
    const url = `https://geo.datav.aliyun.com/areas_v3/bound/${targetAdcode}.json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Civic-12345-Boundary-Service)",
      },
    });

    if (!res.ok) {
      return {
        success: false,
        error: `官方边界服务返回 HTTP 错误 ${res.status}`,
      };
    }

    const geojson = await res.json();
    if (!geojson || geojson.type !== "FeatureCollection" || !geojson.features?.length) {
      return {
        success: false,
        error: "官方服务返回的 GeoJSON 格式不合法或要素为空",
      };
    }

    const feature = geojson.features[0];
    const props = feature.properties || {};

    // 统计总多边形顶点数量
    let pointCount = 0;
    const geom = feature.geometry;
    if (geom?.type === "Polygon") {
      geom.coordinates.forEach((ring: any[]) => {
        pointCount += ring.length;
      });
    } else if (geom?.type === "MultiPolygon") {
      geom.coordinates.forEach((poly: any[][]) => {
        poly.forEach((ring: any[]) => {
          pointCount += ring.length;
        });
      });
    }

    return {
      success: true,
      adcode: targetAdcode,
      name: props.name || districtName,
      geojson,
      pointCount,
      center: props.center,
      centroid: props.centroid,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "请求官方边界服务异常",
    };
  }
}
