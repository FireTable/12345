/**
 * 算力集群节点实时性能与工单耗时度量桥接模块 (Node Metrics)
 * 记录最新一笔工单的处理耗时 (durationMs)，跨进程原子同步
 */
export {
  getNodeMetric,
  getAllNodeMetrics,
  recordNodeMetric,
  formatDuration,
  type NodeMetric,
} from "@civic/system-two";
