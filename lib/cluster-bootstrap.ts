/**
 * next-server 启动时的一次性 bootstrap：扫描所有 region，
 * 对有未处理工单的 region 入队并启动 in-process worker。
 *
 * 触发点：Next.js 的 instrumentation.ts 在 next-server 每次启动时调用 register()。
 * 启动时机包括：
 * - 首次 pnpm dev
 * - Next dev 触发 fast refresh / 重启模块时（dev mode only）
 *
 * 防重入：进程内 global flag 锁，确保 hot reload 时不会重复启动 workers。
 * 幂等：triggerClusterJobAuto 内部已经有进程内 lock + DB unique partial index，
 *       重复调用也是 no-op。
 */
import { getAllRegions } from "@/db/client";
import { triggerClusterJobAuto } from "./cluster-runner";

declare global {
  // eslint-disable-next-line no-var
  var __cluster_bootstrap_done: boolean | undefined;
}

export type BootstrapResult = {
  totalRegions: number;
  triggered: string[];
  skipped: number;
};

let bootstrapInFlight: Promise<BootstrapResult> | null = null;

/**
 * 扫描所有 region，对有未处理工单的 region 触发研判。
 * 同进程内多次调用只跑一次（防 Next dev hot reload 重复触发）。
 */
export async function bootstrapClusterWorkers(): Promise<{
  totalRegions: number;
  triggered: string[];
  skipped: number;
}> {
  // 防 hot reload 重复：只让第一次真正跑
  if (globalThis.__cluster_bootstrap_done) {
    return { totalRegions: 0, triggered: [], skipped: 0 };
  }
  // 同一进程内已有 in-flight 的 bootstrap，等它跑完
  if (bootstrapInFlight) {
    return bootstrapInFlight;
  }

  globalThis.__cluster_bootstrap_done = true;
  bootstrapInFlight = (async () => {
    const triggered: string[] = [];
    let skipped = 0;
    let totalRegions = 0;

    let regions: Array<{ id: string }> = [];
    try {
      regions = await getAllRegions();
    } catch (err: any) {
      console.warn(
        `[cluster-bootstrap] getAllRegions failed: ${err?.message || err}`
      );
      return { totalRegions: 0, triggered, skipped };
    }

    totalRegions = regions.length;
    for (const r of regions) {
      try {
        const ok = await triggerClusterJobAuto(r.id);
        if (ok) {
          triggered.push(r.id);
          console.log(
            `[cluster-bootstrap] ${r.id} 已入队 + 启 in-process worker`
          );
        } else {
          skipped++;
        }
      } catch (err: any) {
        console.warn(
          `[cluster-bootstrap] ${r.id} trigger 失败: ${err?.message || err}`
        );
      }
    }

    console.log(
      `[cluster-bootstrap] 完成：扫描 ${totalRegions} 个 region，触发 ${triggered.length} 个，跳过 ${skipped} 个`
    );
    return { totalRegions, triggered, skipped };
  })();

  const result = await bootstrapInFlight;
  bootstrapInFlight = null;
  return result;
}

/**
 * 测试 / 重新拉起场景用：清掉 global flag 让下次 bootstrap 真正跑。
 * 生产代码不要调用。
 */
export function _resetClusterBootstrapForTesting(): void {
  globalThis.__cluster_bootstrap_done = undefined;
  bootstrapInFlight = null;
}
