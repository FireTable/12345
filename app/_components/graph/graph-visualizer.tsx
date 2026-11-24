"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { GraphData, GraphNode } from "@/backend/state";
import { RefreshCw, Network, X, ZoomIn, ZoomOut } from "lucide-react";
import { Card } from "@/app/_components/ui/card";
import { Button } from "@/app/_components/ui/button";
import { Badge } from "@/app/_components/ui/badge";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Dynamically import ForceGraph2D with ssr: false for Next.js
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface GraphVisualizerProps {
  graphData: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  embedded?: boolean;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  THEME: "多频主题",
  SUBJECT: "规范主体",
  LOCATION: "事发地点",
  TICKET: "关联工单",
};

function isFakeClosureNode(node: any): boolean {
  return Boolean(node?.isFakeClosure || node?.meta?.isFakeClosure);
}

function getNodeRadius(node: any): number {
  if (node?.type === "THEME") {
    const count = Math.max(1, Number(node.ticketCount || 1));
    return 13 + Math.min(4, Math.log10(count));
  }
  if (node?.type === "SUBJECT") return 9;
  if (node?.type === "LOCATION") return 8;
  if (node?.type === "TICKET") {
    return isFakeClosureNode(node) ? 5.5 : 4.5;
  }
  return 6;
}

function getNodeColor(node: any): string {
  if (node?.type === "THEME") {
    if (node.riskLevel === "HIGH") return "#E11D48";
    if (node.riskLevel === "MEDIUM") return "#D97706";
    return "#2563EB";
  }
  if (node?.type === "SUBJECT") return "#0EA5E9";
  if (node?.type === "LOCATION") return "#8B5CF6";
  if (node?.type === "TICKET") {
    return isFakeClosureNode(node) ? "#F43F5E" : "#64748B";
  }
  return node?.color || "#64748B";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export const GraphVisualizer: React.FC<GraphVisualizerProps> = ({
  graphData,
  onNodeClick,
  embedded = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const hasFittedRef = useRef(false);
  const forcesAppliedRef = useRef(false);
  const placedLabelBoxesRef = useRef<Array<{ x: number; y: number; w: number; h: number }>>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  const applyForces = useCallback((instance: any) => {
    if (!instance || typeof instance.d3Force !== "function") return false;
    const charge = instance.d3Force("charge");
    if (charge && typeof charge.strength === "function") {
      charge.strength(-260);
    }
    const link = instance.d3Force("link");
    if (link && typeof link.distance === "function") {
      link.distance((l: any) =>
        l?.target?.type === "TICKET" || l?.source?.type === "TICKET" ? 82 : 68
      );
    }
    if (typeof instance.d3ReheatSimulation === "function") {
      instance.d3ReheatSimulation();
    }
    return true;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width || el.clientWidth);
      const height = Math.floor(rect.height || el.clientHeight);
      if (width > 0 && height > 0) {
        setDimensions((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height }
        );
      }
    };

    updateDimensions();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateDimensions);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    hasFittedRef.current = false;
    forcesAppliedRef.current = false;
    setSelectedNode(null);
    setHoveredNode(null);

    if (dimensions.width <= 0 || dimensions.height <= 0) return;

    let rafId = 0;
    const tryApply = () => {
      if (fgRef.current && applyForces(fgRef.current)) {
        forcesAppliedRef.current = true;
        return;
      }
      rafId = window.requestAnimationFrame(tryApply);
    };
    tryApply();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [graphData, dimensions.width, dimensions.height, applyForces]);

  useEffect(() => {
    if (!selectedNode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedNode(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNode]);

  const handleNodeClick = (node: any) => {
    setSelectedNode(node);
    if (fgRef.current) {
      const duration = prefersReducedMotion() ? 0 : 700;
      fgRef.current.centerAt(node.x, node.y, duration);
      fgRef.current.zoom(2.2, duration);
    }
    if (onNodeClick) {
      onNodeClick(node);
    }
  };

  const handleZoomBy = (factor: number) => {
    if (!fgRef.current || typeof fgRef.current.zoom !== "function") return;
    const current = Number(fgRef.current.zoom()) || 1;
    const next = Math.min(8, Math.max(0.35, current * factor));
    fgRef.current.zoom(next, prefersReducedMotion() ? 0 : 220);
  };

  const fitPadding = Math.max(36, Math.min(64, Math.round(dimensions.height * 0.14)));

  const handleResetZoom = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(prefersReducedMotion() ? 0 : 450, fitPadding);
      setSelectedNode(null);
    }
  };

  const cardShell = (
    <Card
      className={`w-full min-w-0 rounded-xl overflow-hidden border border-border bg-card flex flex-col relative p-0 shadow-2xs ${
        embedded ? "h-[520px] sm:h-[560px]" : "h-[580px] sm:h-[700px]"
      }`}
    >
      {/* Top Control Bar */}
      <div className="p-3 sm:p-4 border-b border-border bg-card flex flex-col gap-2.5 z-10 min-w-0">
        <div className="flex items-start sm:items-center justify-between gap-2.5 flex-wrap min-w-0">
          <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-[min(100%,240px)] flex-1">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Network className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h2 className="text-sm font-bold text-foreground tracking-tight">
                  全景多频图谱拓扑
                </h2>
                <Badge
                  variant="outline"
                  className="text-primary bg-primary/10 border-primary/20 font-mono tabular-nums text-[10px] whitespace-nowrap shrink-0"
                >
                  {graphData.nodes.length} 节点 · {graphData.links.length} 关系
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                展示「工单 ↔ 规范主体 ↔ 发生地点 ↔ 多频主题」网络关联拓扑
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleZoomBy(1.35)}
              aria-label="放大图谱"
              title="放大"
              className="text-xs min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 p-0 bg-card border-border text-foreground hover:bg-muted shrink-0"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleZoomBy(0.75)}
              aria-label="缩小图谱"
              title="缩小"
              className="text-xs min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 p-0 bg-card border-border text-foreground hover:bg-muted shrink-0"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetZoom}
              aria-label="适应屏幕"
              className="text-xs min-h-[44px] sm:min-h-0 sm:h-8 bg-card border-border text-foreground hover:bg-muted whitespace-nowrap shrink-0"
              title="重置居中"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1 shrink-0" aria-hidden="true" />
              <span>适应屏幕</span>
            </Button>
          </div>
        </div>

        {/* Graph Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1.5 rounded-lg border border-border w-full min-w-0">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#E11D48" }} />
            <span>高危主题</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#D97706" }} />
            <span>中危主题</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#2563EB" }} />
            <span>常规主题</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#0EA5E9" }} />
            <span>规范主体</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#8B5CF6" }} />
            <span>地点</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-rose-300" style={{ backgroundColor: "#F43F5E" }} />
            <span>假闭环工单</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#64748B" }} />
            <span>单张工单</span>
          </span>
        </div>
      </div>

      {/* Graph Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 min-w-0 min-h-0 w-full overflow-hidden bg-slate-50/70 relative"
        style={{ cursor: hoveredNode ? "pointer" : "grab" }}
      >
        {graphData.nodes.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
            <Network className="w-7 h-7 text-slate-400" aria-hidden="true" />
            <span>当前辖区暂无可展示的图谱关联节点数据</span>
          </div>
        ) : (
          dimensions.width > 0 &&
          dimensions.height > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            cooldownTicks={90}
            nodeLabel={(node: any) => `${NODE_TYPE_LABELS[node.type] || node.type}: ${node.name}`}
            nodeColor={getNodeColor}
            nodeVal={(node: any) => {
              const r = getNodeRadius(node);
              return (r * r) / 4;
            }}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkColor={(link: any) =>
              link?.isFakeClosure ? "rgba(244, 63, 94, 0.55)" : "rgba(148, 163, 184, 0.38)"
            }
            linkWidth={(link: any) => (link?.isFakeClosure ? 1.8 : 1.2)}
            onNodeClick={handleNodeClick}
            onNodeHover={(node: any) => setHoveredNode((node as GraphNode) || null)}
            onRenderFramePre={() => {
              placedLabelBoxesRef.current = [];
            }}
            onEngineTick={() => {
              if (!forcesAppliedRef.current && fgRef.current && applyForces(fgRef.current)) {
                forcesAppliedRef.current = true;
              }
            }}
            onEngineStop={() => {
              if (!hasFittedRef.current && fgRef.current && graphData.nodes.length > 0) {
                hasFittedRef.current = true;
                fgRef.current.zoomToFit(prefersReducedMotion() ? 0 : 450, fitPadding);
              }
            }}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              if (typeof node.x !== "number" || typeof node.y !== "number") return;
              const r = getNodeRadius(node) + 5;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
              ctx.fill();
            }}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              if (typeof node.x !== "number" || typeof node.y !== "number") return;

              const radius = getNodeRadius(node);
              const color = getNodeColor(node);
              const isFake = isFakeClosureNode(node);
              const isHovered = hoveredNode?.id === node.id;
              const isSelected = selectedNode?.id === node.id;
              const effectiveScale = Math.max(0.65, globalScale);

              // Soft outer halo for key nodes, fake-closure alerts, or active focus
              if (node.type === "THEME" || isHovered || isSelected || isFake) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(
                  node.x,
                  node.y,
                  radius + (isHovered || isSelected ? 5 : 3.5),
                  0,
                  2 * Math.PI,
                  false
                );
                ctx.fillStyle = color;
                ctx.globalAlpha = isHovered || isSelected ? 0.24 : 0.14;
                ctx.fill();
                ctx.restore();
              } else if (node.type === "SUBJECT" || node.type === "LOCATION") {
                ctx.save();
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 2.5, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.12;
                ctx.fill();
                ctx.restore();
              }

              // Prominent crimson outer ring for fake-closure ticket nodes
              if (isFake && node.type === "TICKET") {
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 2.2, 0, 2 * Math.PI, false);
                ctx.strokeStyle = "#E11D48";
                ctx.lineWidth = Math.max(1.2, 1.8 / effectiveScale);
                ctx.stroke();
              }

              // Node core circle
              ctx.beginPath();
              ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
              ctx.fillStyle = color;
              ctx.fill();

              // Crisp white stroke
              ctx.lineWidth = (isSelected || isHovered ? 2.2 : 1.5) / effectiveScale;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();

              const showLabel =
                node.type === "THEME" ||
                node.type === "SUBJECT" ||
                node.type === "LOCATION" ||
                isHovered ||
                isSelected ||
                (node.type === "TICKET" && globalScale >= 2.0);

              if (!showLabel) return;

              const rawLabel = String(node.name || "").trim();
              if (!rawLabel) return;

              const maxChars = node.type === "THEME" ? 12 : node.type === "TICKET" ? 8 : 10;
              const label =
                rawLabel.length > maxChars ? `${rawLabel.slice(0, maxChars)}…` : rawLabel;

              const fontSize = (node.type === "THEME" ? 11.5 : 10.5) / effectiveScale;
              ctx.font = `${node.type === "THEME" || isHovered || isSelected ? 600 : 500} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

              const textMetrics = ctx.measureText(label);
              const padX = 6 / effectiveScale;
              const padY = 2.5 / effectiveScale;
              const pillW = textMetrics.width + padX * 2;
              const pillH = fontSize + padY * 2;
              const pillX = node.x - pillW / 2;
              const pillY = node.y + radius + 4.5 / effectiveScale;
              const gap = 3 / effectiveScale;
              const isPriority = node.type === "THEME" || isHovered || isSelected;
              const collides = placedLabelBoxesRef.current.some(
                (b) =>
                  pillX - gap < b.x + b.w &&
                  pillX + pillW + gap > b.x &&
                  pillY - gap < b.y + b.h &&
                  pillY + pillH + gap > b.y
              );
              if (!isPriority && collides) return;
              placedLabelBoxesRef.current.push({ x: pillX, y: pillY, w: pillW, h: pillH });

              drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
              ctx.fillStyle =
                isHovered || isSelected
                  ? "rgba(255, 255, 255, 0.96)"
                  : "rgba(255, 255, 255, 0.88)";
              ctx.fill();
              ctx.lineWidth = (isHovered || isSelected ? 1.2 : 0.75) / effectiveScale;
              ctx.strokeStyle =
                isHovered || isSelected ? color : "rgba(148, 163, 184, 0.35)";
              ctx.stroke();

              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillStyle = "#0F172A";
              ctx.fillText(label, node.x, pillY + pillH / 2);
            }}
          />
          )
        )}

        {/* Node Inspector Overlay */}
        {selectedNode && (
          <div
            role="region"
            aria-label="节点详情"
            className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:left-4 sm:bottom-4 sm:max-w-sm bg-card/95 backdrop-blur-sm border border-border p-3.5 sm:p-4 rounded-xl shadow-xl text-xs z-20 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-primary uppercase text-[10px] tracking-wide whitespace-nowrap">
                {NODE_TYPE_LABELS[selectedNode.type] || selectedNode.type} 节点详情
              </span>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                aria-label="关闭节点详情"
                className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:w-7 sm:h-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="font-semibold text-foreground text-sm break-words">
              {selectedNode.name}
            </div>
            {selectedNode.ticketCount != null && (
              <div className="text-muted-foreground tabular-nums">
                涉及工单量：<strong className="text-foreground">{selectedNode.ticketCount}</strong> 单
              </div>
            )}
            {isFakeClosureNode(selectedNode) && (
              <div className="inline-flex items-center px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-medium">
                疑似假闭环复发工单
              </div>
            )}
            {selectedNode.meta?.content && (
              <div className="text-muted-foreground bg-muted p-2 rounded border border-border text-[11px] leading-relaxed break-words">
                {selectedNode.meta.content}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );

  if (embedded) {
    return <div className="w-full min-w-0">{cardShell}</div>;
  }

  return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">{cardShell}</div>;
};
