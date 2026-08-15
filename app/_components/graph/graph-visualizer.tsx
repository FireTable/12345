"use client";

import React, { useRef, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphData, GraphNode } from "@/backend/state";
import { RefreshCw, Layers } from "lucide-react";
import { Card } from "@/app/_components/ui/card";
import { Button } from "@/app/_components/ui/button";
import { Badge } from "@/app/_components/ui/badge";

// Dynamically import ForceGraph2D with ssr: false for Next.js
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface GraphVisualizerProps {
  graphData: GraphData;
  onNodeClick?: (node: GraphNode) => void;
}

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({
  graphData,
  onNodeClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 600 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight || 650,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
    if (fgRef.current) {
      fgRef.current.centerAt(node.x, node.y, 1000);
      fgRef.current.zoom(2.5, 1000);
    }
    if (onNodeClick) {
      onNodeClick(node);
    }
  };

  const handleResetZoom = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(800, 50);
      setSelectedNode(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-4">
      <Card className="rounded-2xl overflow-hidden border-slate-800 flex flex-col h-[700px] relative p-0">
        {/* Top Control Bar */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/70 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                全景多频图谱拓扑 (Knowledge Graph View)
                <Badge variant="cyan">
                  {graphData.nodes.length} 节点 · {graphData.links.length} 关系
                </Badge>
              </h2>
              <p className="text-[11px] text-slate-400">
                展示「工单 ↔ 规范主体 ↔ 发生地点 ↔ 多频主题」网络关联拓扑
              </p>
            </div>
          </div>

          {/* Graph Legend & Actions */}
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2.5 text-xs text-slate-400 mr-2 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> 高危主题
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 中危主题
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" /> 规范主体
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-400" /> 地点
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> 单张工单
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleResetZoom}
              className="text-xs h-8"
              title="重置居中"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>适应屏幕</span>
            </Button>
          </div>
        </div>

        {/* Graph Canvas Container */}
        <div ref={containerRef} className="flex-1 w-full h-full bg-slate-950/90 relative">
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeLabel={(node: any) => `${node.type}: ${node.name}`}
            nodeColor={(node: any) => node.color || "#94a3b8"}
            nodeVal={(node: any) => node.val || 10}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkColor={() => "rgba(148, 163, 184, 0.25)"}
            linkWidth={1.5}
            onNodeClick={handleNodeClick}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const label = node.name;
              const fontSize = Math.max(11 / globalScale, 3);
              ctx.font = `${fontSize}px Plus Jakarta Sans, sans-serif`;

              ctx.beginPath();
              ctx.arc(node.x, node.y, node.val ? Math.sqrt(node.val) * 2 : 4, 0, 2 * Math.PI, false);
              ctx.fillStyle = node.color || "#38bdf8";
              ctx.fill();
              ctx.lineWidth = 1 / globalScale;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();

              if (globalScale > 0.8 || node.type === "THEME" || node.type === "SUBJECT") {
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(label.slice(0, 16), node.x, node.y + (node.val ? Math.sqrt(node.val) * 2 + 6 : 8));
              }
            }}
          />

          {/* Node Inspector Overlay */}
          {selectedNode && (
            <div className="absolute bottom-4 left-4 max-w-sm glass-panel bg-slate-900/95 border-slate-700 p-4 rounded-xl shadow-2xl text-xs z-20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-400 uppercase text-[10px]">
                  {selectedNode.type} 节点详情
                </span>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="font-semibold text-white text-sm">{selectedNode.name}</div>
              {selectedNode.ticketCount && (
                <div className="text-slate-300">涉及工单量：<strong>{selectedNode.ticketCount}</strong> 单</div>
              )}
              {selectedNode.meta && (
                <div className="text-slate-400 bg-slate-950 p-2 rounded border border-slate-800 text-[11px] leading-relaxed">
                  {selectedNode.meta.content}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
