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
import { resolvePipelineFactoryStage } from "./pipeline-factory-stage";
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
    /** 建议生成过程中的主题数。themes 表要等写完才有数。 */
    themeCount?: number;
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

  const factory = useMemo(
    () =>
      resolvePipelineFactoryStage({
        isRunning,
        stage: stateData?.taskProgress?.stage,
        stageText: stateData?.taskProgress?.stageText,
        totalTickets: stateData?.metrics.totalTickets ?? 0,
        analyzedTickets: stateData?.metrics.analyzedTickets ?? 0,
        persistedThemes: stateData?.metrics.totalThemes ?? 0,
        progressThemeCount: stateData?.taskProgress?.themeCount ?? 0,
      }),
    [stateData, isRunning],
  );

  // 1. 各工序节点精细化状态机判定
  const initialNodes: Node[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;
    const analyzed = stateData?.metrics.analyzedTickets ?? 0;

    // 用全局已抽取数 analyzed 作单一事实来源，session-local 的 processed 不再覆盖 UI 进度，
    // 避免新 task 启动时 from preExtractedCount 起步导致 "33,377 → 6,356" 的视觉倒退。
    // analyzed 来自 tickets where confidence > 0 的实时 count，
    // 每次 rememberExtraction 写完一条都立刻反映在 DB，下一次 pipeline-state 拉取时 +1。
    const targetProcessed = analyzed;
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
    const entityStatus = factory.entityRunning ? "running" : factory.entityCompleted ? "completed" : "idle";
    const entityStatusText = factory.entityRunning
      ? `提取中 (${targetProcessed.toLocaleString()}/${total.toLocaleString()})`
      : factory.entityCompleted
        ? `提取完成 (${total.toLocaleString()}件)`
        : "等待处理";

    // 04 工序 (同类问题聚合分析)：先嵌入，再聚合。专题数和归集率留在聚类这一步。
    // 建议生成时库里还没有主题，专题数用任务上报的 themeCount。
    const embedCompleted = stateData?.taskProgress?.processed ?? 0;
    const embedEligible = stateData?.taskProgress?.total ?? 0;
    const clusterStatusText = factory.embedding
      ? `嵌入中（${embedCompleted}/${embedEligible}）`
      : factory.clusterStatusText;

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
          themeCount: factory.clusterThemeCount,
          totalTickets: total,
          recentClusters: (stateData?.recentThemes || []).map((th) => ({
            id: th.id,
            title: th.title,
            ticketCount: th.ticketCount,
            category: th.category,
            subdistrict: th.canonicalLocation,
          })),
          status: factory.clusterStatus,
          statusText: clusterStatusText,
          embedding: factory.embedding,
          embedCompleted,
          embedEligible,
        } as ClusterNodeData,
      },
      {
        id: "node-dossier",
        type: "dossier",
        position: getPos("node-dossier"),
        data: {
          dossierCount: factory.dossierCount,
          totalTickets: total,
          pseudoLoopCount: stateData?.metrics.highRiskThemes ?? 0,
          status: factory.dossierStatus,
          statusText: factory.dossierStatusText,
        } as DossierNodeData,
      },
    ];
  }, [stateData, isRunning, processed, onRefresh, storageKey, factory]);

  // 2. 连接边配置 (根据活跃阶段动态激活流动粒子导轨)
  const initialEdges: Edge[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;

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
        animated: factory.entityRunning,
        data: {
          active: factory.entityRunning,
          completed: factory.entityCompleted,
          label: "要素提取",
        },
      },
      {
        id: "edge-entity-cluster",
        source: "node-entity",
        target: "node-cluster",
        type: "flowing",
        animated: factory.clusterEdgeActive,
        data: {
          active: factory.clusterEdgeActive,
          completed: factory.clusterCompleted,
          label: "同类归并",
        },
      },
      {
        id: "edge-cluster-dossier",
        source: "node-cluster",
        target: "node-dossier",
        type: "flowing",
        animated: factory.dossierRunning,
        data: {
          active: factory.dossierRunning,
          completed: factory.dossierCompleted,
          label: "生成案卷",
        },
      },
    ];
  }, [isRunning, stateData, processed, factory]);

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
  pending = false,
}: {
  stateData: PipelineStateResponse | null;
  onRefresh: () => void;
  /** 抽屉刚打开、还没有第一份快照。已有快照时刷新不再盖住画布。 */
  pending?: boolean;
}) {
  const showVeil = !stateData;

  return (
    <div className="workbench-canvas-container" aria-busy={pending}>
      <ReactFlowProvider>
        <InnerPipelineCanvas stateData={stateData} onRefresh={onRefresh} />
      </ReactFlowProvider>
      {showVeil ? (
        <div className="workbench-canvas-pending">
          {pending ? (
            <>
              <span className="workbench-canvas-spinner" aria-hidden="true" />
              <p className="workbench-canvas-pending__title">正在读取流水线</p>
              <p className="workbench-canvas-pending__sub">确认算力节点和当前进度</p>
            </>
          ) : (
            <>
              <p className="workbench-canvas-pending__title">流水线状态暂时没有取到</p>
              <button type="button" className="workbench-canvas-pending__retry" onClick={onRefresh}>
                重试
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
