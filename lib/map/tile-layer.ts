/**
 * 天地图瓦片图层加载器 (自适应前端 CDN 直连 + 后端容灾代理)
 * 
 * 1. 若配置了 NEXT_PUBLIC_TIANDITU_TK (浏览器端 Key)，浏览器直连天地图全国边缘 CDN (t0~t7 域名轮询负载均衡)，
 *    零 VPS 流量中转，免受海外机房 WAF 418 限制，毫秒级瞬时加载。
 * 2. 若未配置前端 Key，优雅回退至本地后端代理 (/api/map/tile)，自带内存 LRU 缓存池与智能容灾。
 */

export function getTiandituTileUrls() {
  const tk =
    (typeof window !== "undefined" && (window as any).__TIANDITU_TK__) ||
    process.env.NEXT_PUBLIC_TIANDITU_TK;
  if (tk && tk.trim() && tk !== "your_tianditu_frontend_key_here") {
    const key = tk.trim();
    return {
      vecUrl: `https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`,
      cvaUrl: `https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`,
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
      isDirect: true,
    };
  }
  return {
    vecUrl: "/api/map/tile?type=vec&z={z}&x={x}&y={y}",
    cvaUrl: "/api/map/tile?type=cva&z={z}&x={x}&y={y}",
    subdomains: [] as string[],
    isDirect: false,
  };
}
