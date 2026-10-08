"use client";

import React, { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RotateCcw } from "lucide-react";

import { FlowingEdge } from "./flowing-edge";
import { IngestNode, type IngestNodeData } from "./nodes/ingest-node";
import { TriageNode, type TriageNodeData } from "./nodes/triage-node";
import { EntityNode, type EntityNodeData } from "./nodes/entity-node";
import { ClusterNode, type ClusterNodeData } from "./nodes/cluster-node";
import { DossierNode, type DossierNodeData } from "./nodes/dossier-node";
import { useRegion } from "@/app/_components/civic/region-context";

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  "node-ingest": { x: 80, y: 60 },
  "node-triage": { x: 620, y: 60 },
  "node-entity": { x: 1160, y: 60 },
  "node-cluster": { x: 1160, y: 560 },
  // 案卷归档卡片下移：triage 卡片自带饼图 + 22 个镇街，实际渲染高度约 730px，
  // 旧 y=560 会与 triage 卡片下半段重叠。给到 860，留出 60+px 视觉缓冲。
  "node-dossier": { x: 620, y: 860 },
};

function getSavedPositions(key: string): Record<string, { x: number; y: number }> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePositions(key: string, positions: Record<string, { x: number; y: number }>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(positions));
  } catch { }
}

export type PipelineStateResponse = {
  regionId: string;
  regionName: string;
  cityName: string;
  taskProgress: {
    taskId?: string;
    status: string;
    stage?: string;
    stageText?: string;
    processed: number;
    total: number;
    percent?: number;
    currentSubject?: string;
    currentLocation?: string;
    currentEventType?: string;
    /**
     * Per-endpoint 最近处理过的工单预览（in-memory，process-singleton）。
     * Key: endpoint URL；Value: 倒序的最近工单。
     * 替换之前的 modulo 切 DB 列表的方案。
     */
    endpointRecentTickets?: Record<
      string,
      Array<{
        id: string;
        ticketNo?: string;
        address?: string | null;
        canonicalSubject?: string | null;
        eventType?: string | null;
        durationMs?: number;
        processedAt: number;
      }>
    >;
  } | null;
  metrics: {
    totalTickets: number;
    analyzedTickets: number;
    unprocessedTickets: number;
    urgentTickets: number;
    stabilityRiskTickets: number;
    totalThemes: number;
    highRiskThemes: number;
  };
  categoryStats: Array<{ category: string; count: number }>;
  townshipStats?: Array<{ township: string; count: number }>;
  recentTickets: Array<{
    id: string;
    ticketNo: string;
    title: string;
    content: string;
    canonicalSubject?: string;
    address?: string;
    district?: string;
    subdistrict?: string;
    sourceCategory?: string;
    urgency?: string;
    stabilityRisk?: boolean;
    confidence?: number;
    createTime?: string;
    eventType?: string;
  }>;
  recentThemes: Array<{
    id: string;
    title: string;
    canonicalSubject?: string;
    canonicalLocation?: string;
    category?: string;
    riskLevel?: string;
    ticketCount: number;
    recommendedAction?: string;
    handlingStatus?: string;
  }>;
  systemTwoNodes?: Array<{
    id: string;
    name: string;
    host: string;
    isLocal: boolean;
    isOnline?: boolean;
    lastDurationMs?: number | null;
  }>;
  recentExtractedTickets?: Array<{
    id: string;
    ticketNo: string;
    title: string;
    content: string;
    canonicalSubject?: string;
    address?: string;
    district?: string;
    subdistrict?: string;
    sourceCategory?: string;
    urgency?: string;
    stabilityRisk?: boolean;
    confidence?: number;
    createTime?: string;
    eventType?: string;
    updatedAt?: string;
  }>;
};

const nodeTypes = {
  ingest: IngestNode,
  triage: TriageNode,
  entity: EntityNode,
  cluster: ClusterNode,
  dossier: DossierNode,
};

const edgeTypes = {
  flowing: FlowingEdge,
};

function InnerPipelineCanvas({
  stateData,
  onRefresh,
}: {
  stateData: PipelineStateResponse | null;
  onRefresh: () => void;
}) {
  const { fitView } = useReactFlow();
  const { activeRegion } = useRegion();
  // v7: 案卷归档节点下移到 y=860，避免与超高的分类初筛节点下半段重叠
  const storageKey = `civic_workbench_pipeline_positions_v7_${activeRegion?.id || "default"}`;

  const rawStatus = (stateData?.taskProgress?.status || "").toUpperCase();
  const isRunning = rawStatus === "RUNNING";
  const processed = stateData?.taskProgress?.processed ?? 0;

  // 1. 各工序节点精细化状态机判定
  const initialNodes: Node[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;
    const analyzed = stateData?.metrics.analyzedTickets ?? 0;
    const themeCount = stateData?.metrics.totalThemes ?? 0;
    const isCompleted = total > 0 && analyzed >= total && !isRunning;
    const stage = (stateData?.taskProgress?.stage || "EXTRACTING").toUpperCase();

    const targetProcessed = isRunning ? processed : analyzed;
    // 用 Math.floor 而不是 round：99.55% 应显示 99%，避免进位到 100% 让用户误以为 S2 已跑完
    const entityPercent = total > 0
      ? targetProcessed >= total
        ? 100
        : Math.floor((targetProcessed / total) * 100)
      : 0;

    const savedPos = getSavedPositions(storageKey);
    const getPos = (id: string) => savedPos?.[id] || DEFAULT_POSITIONS[id] || { x: 0, y: 0 };

    // 01 工序 (工单接收与导入): 只要库里有工单即已就绪完成
    const ingestStatus = total > 0 ? "completed" : "idle";
    const ingestStatusText = total > 0 ? `工单已接入 (${total.toLocaleString()}件)` : "等待导入";

    // 02 工序 (分类初筛与分流): 接入后初筛分流统计已生成
    const triageStatus = total > 0 ? "completed" : "idle";
    const triageStatusText = total > 0 ? "初筛分流完成" : "等待处理";

    // 03 工序 (地点与主体提取): 正在处理时 active running，完成后 completed
    const isEntityRunning = isRunning && (stage === "EXTRACTING" || targetProcessed < total);
    const isEntityCompleted = (total > 0 && analyzed >= total) || stage === "CLUSTERING" || stage === "SUMMARIZING" || stage === "COMPLETED" || isCompleted;
    const entityStatus = isEntityRunning ? "running" : isEntityCompleted ? "completed" : "idle";
    const entityStatusText = isEntityRunning
      ? `提取中 (${targetProcessed.toLocaleString()}/${total.toLocaleString()})`
      : isEntityCompleted
        ? `提取完成 (${total.toLocaleString()}件)`
        : "等待处理";

    // 04 工序 (同类问题聚合分析)
    const isClusterRunning = isRunning && (stage === "CLUSTERING" || (stage === "EXTRACTING" && targetProcessed >= total && total > 0));
    const isClusterCompleted = isCompleted || (themeCount > 0 && (stage === "SUMMARIZING" || stage === "COMPLETED" || !isRunning));
    const clusterStatus = isClusterRunning ? "running" : isClusterCompleted ? "completed" : "idle";
    const clusterStatusText = isClusterRunning
      ? "正在聚合归类"
      : isClusterCompleted
        ? `聚合完成 (${themeCount.toLocaleString()}组)`
        : "等待分析";

    // 05 工序 (处置建议与案卷归档)
    const isDossierRunning = isRunning && stage === "SUMMARIZING";
    const isDossierCompleted = isCompleted || (themeCount > 0 && !isRunning);
    const dossierStatus = isDossierRunning ? "running" : isDossierCompleted ? "completed" : "idle";
    const dossierStatusText = isDossierRunning
      ? "正在生成案卷"
      : isDossierCompleted
        ? "案卷已就绪"
        : "等待生成";

    return [
      {
        id: "node-ingest",
        type: "ingest",
        position: getPos("node-ingest"),
        data: {
          totalTickets: total,
          unprocessedTickets: stateData?.metrics.unprocessedTickets ?? 0,
          recentTickets: (stateData?.recentTickets || []).map((t) => ({
            ticketNo: t.ticketNo,
            title: t.title,
            content: t.content || "",
            subdistrict: t.subdistrict,
            createTime: t.createTime,
          })),
          status: ingestStatus,
          statusText: ingestStatusText,
          onIngestSuccess: onRefresh,
        } as IngestNodeData,
      },
      {
        id: "node-triage",
        type: "triage",
        position: getPos("node-triage"),
        data: {
          urgentCount: stateData?.metrics.urgentTickets ?? 0,
          stabilityRiskCount: stateData?.metrics.stabilityRiskTickets ?? 0,
          categoryStats: stateData?.categoryStats || [],
          townshipStats: stateData?.townshipStats || [],
          status: triageStatus,
          statusText: triageStatusText,
          classifiedCount: targetProcessed,
        } as TriageNodeData,
      },
      (() => {
        const clusterNodes = stateData?.systemTwoNodes || [
          { id: "node-1", name: "研判节点一", host: "127.0.0.1:8132", isLocal: true },
        ];

        // 为每个研判节点分配其处理的近两条工单
        // 来源：in-memory 的 endpointRecentTickets（SystemTwoEngine 进程内按 endpoint 维护），
        //       key 是完整 URL（含 http:// 前缀和 /v1 后缀）；
        //       clusterNodes[].host 只是 host:port（如 "127.0.0.1:8132"）。
        //       做规范化匹配：双方都去协议前缀和 /v1 后缀再比对。
        const endpointRecentTickets = stateData?.taskProgress?.endpointRecentTickets || {};
        const normalizeEndpoint = (s: string) =>
          s.replace(/^https?:\/\//i, "").replace(/\/v1\/?$/, "").toLowerCase();
        const entityClusterNodes = clusterNodes.map((n) => {
          if (!n.host) {
            return {
              id: n.id,
              name: n.name,
              host: n.host,
              isLocal: n.isLocal,
              isOnline: n.isOnline,
              lastDurationMs: n.lastDurationMs ?? null,
              recentTickets: [],
            };
          }
          const targetNorm = normalizeEndpoint(n.host);
          // 1) 精确匹配；2) 规范化后匹配（兼容 http:// 前缀和 /v1 后缀）
          const matched =
            endpointRecentTickets[n.host] ||
            Object.entries(endpointRecentTickets).find(
              ([k]) => normalizeEndpoint(k) === targetNorm
            )?.[1] ||
            [];
          const myTickets: Array<{
            id: string;
            ticketNo?: string;
            address?: string | null;
            canonicalSubject?: string | null;
            eventType?: string | null;
            durationMs?: number;
            processedAt: number;
          }> = matched.slice(0, 2);

          return {
            id: n.id,
            name: n.name,
            host: n.host,
            isLocal: n.isLocal,
            isOnline: n.isOnline,
            lastDurationMs: n.lastDurationMs ?? null,
            recentTickets: myTickets.map((t) => ({
              id: t.id,
              ticketNo: t.ticketNo,
              address: t.address ?? null,
              canonicalSubject: t.canonicalSubject ?? null,
              eventType: t.eventType ?? null,
            })),
          };
        });

        return {
          id: "node-entity",
          type: "entity",
          position: getPos("node-entity"),
          data: {
            processed: targetProcessed,
            total,
            extractedCount: targetProcessed,
            nodes: entityClusterNodes,
            currentLocation:
              stateData?.taskProgress?.currentLocation ||
              stateData?.recentExtractedTickets?.[0]?.address ||
              stateData?.recentTickets?.[0]?.address ||
              undefined,
            currentSubject:
              stateData?.taskProgress?.currentSubject ||
              stateData?.recentExtractedTickets?.[0]?.canonicalSubject ||
              stateData?.recentTickets?.[0]?.canonicalSubject ||
              undefined,
            currentEventType:
              stateData?.taskProgress?.currentEventType ||
              stateData?.recentExtractedTickets?.[0]?.eventType ||
              stateData?.recentTickets?.[0]?.eventType ||
              undefined,
            status: entityStatus,
            statusText: entityStatusText,
            percent: entityPercent,
          } as EntityNodeData,
        };
      })(),
      {
        id: "node-cluster",
        type: "cluster",
        position: getPos("node-cluster"),
        data: {
          themeCount: themeCount,
          totalTickets: total,
          recentClusters: (stateData?.recentThemes || []).map((th) => ({
            id: th.id,
            title: th.title,
            ticketCount: th.ticketCount,
            category: th.category,
            subdistrict: th.canonicalLocation,
          })),
          status: clusterStatus,
          statusText: clusterStatusText,
        } as ClusterNodeData,
      },
      {
        id: "node-dossier",
        type: "dossier",
        position: getPos("node-dossier"),
        data: {
          dossierCount: themeCount,
          totalTickets: total,
          pseudoLoopCount: stateData?.metrics.highRiskThemes ?? 0,
          status: dossierStatus,
          statusText: dossierStatusText,
        } as DossierNodeData,
      },
    ];
  }, [stateData, isRunning, processed, onRefresh, storageKey]);

  // 2. 连接边配置 (根据活跃阶段动态激活流动粒子导轨)
  const initialEdges: Edge[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;
    const analyzed = stateData?.metrics.analyzedTickets ?? 0;
    const themeCount = stateData?.metrics.totalThemes ?? 0;
    const isCompleted = total > 0 && analyzed >= total && !isRunning;
    const stage = (stateData?.taskProgress?.stage || "EXTRACTING").toUpperCase();
    const targetProcessed = isRunning ? processed : analyzed;

    const isEntityRunning = isRunning && (stage === "EXTRACTING" || targetProcessed < total);
    const isEntityCompleted = (total > 0 && analyzed >= total) || stage === "CLUSTERING" || stage === "SUMMARIZING" || stage === "COMPLETED" || isCompleted;
    const isClusterRunning = isRunning && (stage === "CLUSTERING" || (stage === "EXTRACTING" && targetProcessed >= total && total > 0));
    const isClusterCompleted = isCompleted || (themeCount > 0 && (stage === "SUMMARIZING" || stage === "COMPLETED" || !isRunning));
    const isDossierRunning = isRunning && stage === "SUMMARIZING";
    const isDossierCompleted = isCompleted || (themeCount > 0 && !isRunning);

    return [
      {
        id: "edge-ingest-triage",
        source: "node-ingest",
        target: "node-triage",
        type: "flowing",
        animated: total > 0 && isRunning,
        data: {
          // 跟其它三条边一致：active 仅在流水线真正在跑时为 true。
          // 任务跑完后这一段已经流过去，应该走 completed 实线绿，
          // 而不是继续以虚线/流动光点形式呈现（"进度条形态"）。
          active: total > 0 && isRunning,
          completed: total > 0,
          label: "初筛分流",
        },
      },
      {
        id: "edge-triage-entity",
        source: "node-triage",
        target: "node-entity",
        type: "flowing",
        animated: isEntityRunning,
        data: {
          active: isEntityRunning,
          completed: isEntityCompleted,
          label: "要素提取",
        },
      },
      {
        id: "edge-entity-cluster",
        source: "node-entity",
        target: "node-cluster",
        type: "flowing",
        animated: isClusterRunning,
        data: {
          active: isClusterRunning,
          completed: isClusterCompleted,
          label: "同类归并",
        },
      },
      {
        id: "edge-cluster-dossier",
        source: "node-cluster",
        target: "node-dossier",
        type: "flowing",
        animated: isDossierRunning,
        data: {
          active: isDossierRunning,
          completed: isDossierCompleted,
          label: "生成案卷",
        },
      },
    ];
  }, [isRunning, stateData, processed]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 关键：监听 initialNodes 数据变化时，智能保留用户在画布上已拖拽的实际物理位置，仅更新业务数据与状态！
  useEffect(() => {
    setNodes((prevNodes) => {
      if (!prevNodes || prevNodes.length === 0) return initialNodes;

      return initialNodes.map((newNode) => {
        const existing = prevNodes.find((p) => p.id === newNode.id);
        if (existing) {
          return {
            ...newNode,
            // 保留拖拽位置，以及已经量到的宽高。刷新时若丢掉 measured，
            // React Flow 会把节点设成 visibility:hidden，尺寸没变时观察器不再回调，节点就一直不出现。
            position: existing.position,
            selected: existing.selected,
            measured: existing.measured,
            width: existing.width,
            height: existing.height,
          };
        }
        return newNode;
      });
    });
  }, [initialNodes, setNodes]);

  // 同步边状态
  useEffect(() => {
    setEdges((prevEdges) => {
      if (!prevEdges || prevEdges.length === 0) return initialEdges;
      return initialEdges.map((newEdge) => {
        const existing = prevEdges.find((e) => e.id === newEdge.id);
        return existing ? { ...existing, ...newEdge } : newEdge;
      });
    });
  }, [initialEdges, setEdges]);

  // 节点拖拽停止时，实时持久化最新位置到 localStorage
  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: Node, allNodes: Node[]) => {
      const posMap: Record<string, { x: number; y: number }> = {};
      for (const n of allNodes) {
        posMap[n.id] = n.position;
      }
      savePositions(storageKey, posMap);
    },
    [storageKey]
  );

  // 用户点击“复位标准排版”：清除本地位置并平滑回归默认 3列2行流向
  const handleResetLayout = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(storageKey);
      } catch { }
    }
    setNodes((prevNodes) =>
      prevNodes.map((n) => ({
        ...n,
        position: DEFAULT_POSITIONS[n.id] || n.position,
      }))
    );
    setTimeout(() => {
      fitView({ padding: 0.12, duration: 600 });
    }, 50);
  }, [storageKey, setNodes, fitView]);

  // 挂载初始自动居中
  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.12, duration: 600 });
    }, 150);
    return () => clearTimeout(timer);
  }, [fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={0.3}
      maxZoom={1.5}
      defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#CBD5E1" gap={20} size={1.2} variant={BackgroundVariant.Dots} />

      {/* 顶部工具栏：一键复位标准排版 */}
      <Panel position="top-right" className="m-3">
        <button
          type="button"
          onClick={handleResetLayout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white/95 hover:bg-white hover:text-slate-900 border border-slate-200/90 rounded-lg shadow-xs hover:shadow-md transition-all cursor-pointer backdrop-blur-md active:scale-95"
          title="恢复 3列2行 蛇形无交叉标准排版并自适应居中"
        >
          <RotateCcw size={12} className="text-slate-500" />
          <span>复位标准排版</span>
        </button>
      </Panel>

      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

export function PipelineCanvas({
  stateData,
  onRefresh,
}: {
  stateData: PipelineStateResponse | null;
  onRefresh: () => void;
}) {
  return (
    <div className="workbench-canvas-container">
      <ReactFlowProvider>
        <InnerPipelineCanvas stateData={stateData} onRefresh={onRefresh} />
      </ReactFlowProvider>
    </div>
  );
}
