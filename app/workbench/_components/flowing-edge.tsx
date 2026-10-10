"use client";

import React from "react";
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";

export type FlowingEdgeData = {
  active?: boolean;
  completed?: boolean;
  label?: string;
};

export type FlowingEdgeType = Edge<FlowingEdgeData, "flowing">;

export function FlowingEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<FlowingEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = data?.active ?? false;
  const isCompleted = data?.completed ?? false;

  const strokeColor = isCompleted
    ? "#22C55E"
    : isActive
    ? "#3B82F6"
    : "#CBD5E1";

  return (
    <>
      {/* 底层基础轨道 */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth: isActive ? 2.5 : 1.8,
          strokeDasharray: isActive ? "6, 4" : undefined,
          transition: "stroke 0.4s, stroke-width 0.4s",
          opacity: isActive ? 0.9 : 0.65,
        }}
      />

      {/* 运行时流动的科技脉冲光束 (Animated Beam Particle) */}
      {isActive && (
        <circle r="4" fill="#3B82F6" className="flowing-beam-circle">
          <animateMotion
            dur="1.8s"
            repeatCount="indefinite"
            path={edgePath}
            rotate="auto"
          />
        </circle>
      )}

      {/* 中途微标签 */}
      {data?.label && (
        <foreignObject
          width={100}
          height={24}
          x={labelX - 50}
          y={labelY - 12}
          className="pointer-events-none"
        >
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/95 border border-slate-200 text-slate-600 shadow-2xs">
              {data.label}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}
