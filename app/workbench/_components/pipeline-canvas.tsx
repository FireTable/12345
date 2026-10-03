"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  "node-triage": { x: 600, y: 60 },
  "node-entity": { x: 1120, y: 60 },
  "node-cluster": { x: 1120, y: 560 },
  "node-dossier": { x: 600, y: 560 },
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
  } catch {}
}

export type PipelineStateResponse = {
  regionId: string;
  regionName: string;
  cityName: string;
  taskProgress: {
    taskId?: string;
    status: "idle" | "running" | "completed" | "error";
    processed: number;
    total: number;
    stageText?: string;
    currentSubject?: string;
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
  const storageKey = `civic_workbench_pipeline_positions_v5_${activeRegion?.id || "default"}`;

  const isRunning = stateData?.taskProgress?.status === "running";
  const processed = stateData?.taskProgress?.processed ?? 0;
  const taskTotal = stateData?.taskProgress?.total ?? (stateData?.metrics.totalTickets || 0);

  // 1. 计算各个节点的活跃度与状态 (若有本地记忆则优先使用拖拽后保存的位置)
  const initialNodes: Node[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;
    const analyzed = stateData?.metrics.analyzedTickets ?? 0;
    const isCompleted = total > 0 && analyzed >= total && !isRunning;

    const targetProcessed = isRunning ? processed : analyzed;
    const entityPercent = total > 0 ? Math.round((targetProcessed / total) * 100) : 0;

    const savedPos = getSavedPositions(storageKey);
    const getPos = (id: string) => savedPos?.[id] || DEFAULT_POSITIONS[id] || { x: 0, y: 0 };

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
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
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
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
          classifiedCount: targetProcessed,
        } as TriageNodeData,
      },
      {
        id: "node-entity",
        type: "entity",
        position: getPos("node-entity"),
        data: {
          processed: targetProcessed,
          total,
          extractedCount: targetProcessed,
          currentLocation: stateData?.recentTickets?.[0]?.address || undefined,
          currentSubject:
            stateData?.taskProgress?.currentSubject ||
            stateData?.recentTickets?.[0]?.canonicalSubject ||
            undefined,
          currentEventType: stateData?.recentTickets?.[0]?.eventType || undefined,
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
          percent: entityPercent,
        } as EntityNodeData,
      },
      {
        id: "node-cluster",
        type: "cluster",
        position: getPos("node-cluster"),
        data: {
          themeCount: stateData?.metrics.totalThemes ?? 0,
          totalTickets: total,
          recentClusters: (stateData?.recentThemes || []).map((th) => ({
            id: th.id,
            title: th.title,
            ticketCount: th.ticketCount,
            category: th.category,
            subdistrict: th.canonicalLocation,
          })),
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
        } as ClusterNodeData,
      },
      {
        id: "node-dossier",
        type: "dossier",
        position: getPos("node-dossier"),
        data: {
          dossierCount: stateData?.metrics.totalThemes ?? 0,
          totalTickets: total,
          pseudoLoopCount: stateData?.metrics.highRiskThemes ?? 0,
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
        } as DossierNodeData,
      },
    ];
  }, [stateData, isRunning, processed, onRefresh, storageKey]);

  // 2. 连接边配置 (带流光脉冲效果与换行平滑导轨)
  const initialEdges: Edge[] = useMemo(() => {
    const isCompleted = (stateData?.metrics.totalTickets || 0) > 0 &&
      (stateData?.metrics.analyzedTickets || 0) >= (stateData?.metrics.totalTickets || 0) &&
      !isRunning;

    return [
      {
        id: "edge-ingest-triage",
        source: "node-ingest",
        target: "node-triage",
        type: "flowing",
        animated: isRunning,
        data: {
          active: isRunning,
          completed: isCompleted,
          label: "初筛分流",
        },
      },
      {
        id: "edge-triage-entity",
        source: "node-triage",
        target: "node-entity",
        type: "flowing",
        animated: isRunning,
        data: {
          active: isRunning,
          completed: isCompleted,
          label: "要素提取",
        },
      },
      {
        id: "edge-entity-cluster",
        source: "node-entity",
        target: "node-cluster",
        type: "flowing",
        animated: isRunning,
        data: {
          active: isRunning,
          completed: isCompleted,
          label: "同类归并",
        },
      },
      {
        id: "edge-cluster-dossier",
        source: "node-cluster",
        target: "node-dossier",
        type: "flowing",
        animated: isRunning,
        data: {
          active: isRunning,
          completed: isCompleted,
          label: "生成案卷",
        },
      },
    ];
  }, [isRunning, stateData]);

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
            // 严格保留用户拖动后的真实位置，防止接口刷新导致回滚！
            position: existing.position,
            selected: existing.selected,
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
      } catch {}
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
