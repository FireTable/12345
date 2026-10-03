"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { FlowingEdge } from "./flowing-edge";
import { IngestNode, type IngestNodeData } from "./nodes/ingest-node";
import { TriageNode, type TriageNodeData } from "./nodes/triage-node";
import { EntityNode, type EntityNodeData } from "./nodes/entity-node";
import { ClusterNode, type ClusterNodeData } from "./nodes/cluster-node";
import { DossierNode, type DossierNodeData } from "./nodes/dossier-node";
import { useRegion } from "@/app/_components/civic/region-context";

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

  const isRunning = stateData?.taskProgress?.status === "running";
  const processed = stateData?.taskProgress?.processed ?? 0;
  const taskTotal = stateData?.taskProgress?.total ?? (stateData?.metrics.totalTickets || 0);

  // 1. 计算各个节点的活跃度与状态
  const initialNodes: Node[] = useMemo(() => {
    const total = stateData?.metrics.totalTickets ?? 0;
    const analyzed = stateData?.metrics.analyzedTickets ?? 0;
    const isCompleted = total > 0 && analyzed >= total && !isRunning;

    const targetProcessed = isRunning ? processed : analyzed;
    const entityPercent = total > 0 ? Math.round((targetProcessed / total) * 100) : 0;

    return [
      {
        id: "node-ingest",
        type: "ingest",
        position: { x: 80, y: 60 },
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
        position: { x: 520, y: 60 },
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
        position: { x: 960, y: 60 },
        data: {
          processed: targetProcessed,
          total,
          extractedCount: targetProcessed,
          currentTicketNo: isRunning
            ? (stateData?.taskProgress?.taskId || "进行中")
            : (stateData?.recentTickets?.[0]?.ticketNo || undefined),
          currentTime: stateData?.recentTickets?.[0]?.createTime || undefined,
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
        position: { x: 960, y: 540 },
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
        position: { x: 520, y: 540 },
        data: {
          dossierCount: stateData?.metrics.totalThemes ?? 0,
          totalTickets: total,
          pseudoLoopCount: stateData?.metrics.highRiskThemes ?? 0,
          status: isRunning ? "running" : isCompleted ? "completed" : "idle",
        } as DossierNodeData,
      },
    ];
  }, [stateData, isRunning, processed, onRefresh]);

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
          label: "要素过滤",
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
          label: "主体提炼",
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
          label: "时空聚类",
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
          label: "成卷建档",
        },
      },
    ];
  }, [isRunning, stateData]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 监听 initialNodes / initialEdges 变化同步到内部状态
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

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
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      minZoom={0.3}
      maxZoom={1.5}
      defaultViewport={{ x: 0, y: 0, zoom: 0.82 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#CBD5E1" gap={20} size={1.2} variant={BackgroundVariant.Dots} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        nodeColor={(node) => {
          if (node.id === "node-ingest") return "#2563EB";
          if (node.id === "node-triage") return "#D97706";
          if (node.id === "node-entity") return "#7C3AED";
          if (node.id === "node-cluster") return "#0891B2";
          if (node.id === "node-dossier") return "#059669";
          return "#94A3B8";
        }}
        position="bottom-right"
        style={{
          borderRadius: 8,
          border: "1px solid #E2E8F0",
          background: "rgba(255, 255, 255, 0.8)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        }}
      />
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
