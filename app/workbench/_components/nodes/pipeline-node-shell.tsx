"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";

export type PipelineNodeStatus = "idle" | "running" | "completed";

export interface PipelineNodeShellProps {
  stepNumber: string; // e.g. "01", "02"
  title: string;
  icon: React.ReactNode;
  iconGradient?: string;
  themeColor?: string; // 节点主色调，用于 active 状态边框/流光/发光
  status: PipelineNodeStatus;
  statusText?: string;
  hasTargetHandle?: boolean;
  targetHandleColor?: string;
  targetHandlePosition?: Position;
  hasSourceHandle?: boolean;
  sourceHandleColor?: string;
  sourceHandlePosition?: Position;
  children: React.ReactNode;
}

/**
 * 将 hex 颜色转换为 "r, g, b" 字符串，供 rgba() 使用
 */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

export function PipelineNodeShell({
  stepNumber,
  title,
  icon,
  iconGradient = "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
  themeColor = "#2563EB",
  status,
  statusText,
  hasTargetHandle = true,
  targetHandleColor = "#3B82F6",
  targetHandlePosition = Position.Left,
  hasSourceHandle = true,
  sourceHandleColor = "#3B82F6",
  sourceHandlePosition = Position.Right,
  children,
}: PipelineNodeShellProps) {
  const isActive = status === "running";
  const isCompleted = status === "completed";

  // 状态标签默认语意
  const defaultStatusText = isActive
    ? "研判作业中"
    : isCompleted
    ? "工序就绪"
    : "待调度";
  const tagLabel = statusText || defaultStatusText;

  return (
    <div
      className={`pipeline-node ${
        isActive ? "pipeline-node--active" : isCompleted ? "pipeline-node--completed" : ""
      }`}
      style={{
        "--node-accent": themeColor,
        "--node-accent-rgb": hexToRgb(themeColor),
        "--node-gradient": iconGradient,
      } as React.CSSProperties}
    >
      {/* 输入连接 Handle */}
      {hasTargetHandle && (
        <Handle
          type="target"
          position={targetHandlePosition}
          style={{
            width: 10,
            height: 10,
            background: targetHandleColor,
            border: "2px solid #FFFFFF",
            boxShadow: "0 0 6px rgba(0, 0, 0, 0.18)",
          }}
        />
      )}

      {/* 节点规范化头部 */}
      <div className="pipeline-node__header">
        <div className="pipeline-node__title-wrap">
          <div
            className="pipeline-node__icon-box"
            style={{ background: iconGradient }}
          >
            {icon}
          </div>
          <div>
            <div className="pipeline-node__step-idx">工序 {stepNumber}</div>
            <div className="pipeline-node__name">{title}</div>
          </div>
        </div>

        <span
          className="pipeline-node__tag flex items-center gap-1.5"
          style={{
            background: isActive
              ? `color-mix(in srgb, ${themeColor} 10%, #FFFFFF)`
              : isCompleted ? "#F0FDF4" : "#F1F5F9",
            color: isActive ? themeColor : isCompleted ? "#16A34A" : "#64748B",
            borderColor: isActive
              ? `color-mix(in srgb, ${themeColor} 30%, transparent)`
              : isCompleted ? "#BBF7D0" : "#E2E8F0",
            fontWeight: isActive ? 600 : 500,
          }}
        >
          {isActive && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: themeColor }}></span>
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: themeColor }}></span>
            </span>
          )}
          {tagLabel}
        </span>
      </div>

      {/* 节点主体内容插槽：严格统一 padding 和间距 */}
      <div className="pipeline-node__body">{children}</div>

      {/* 输出连接 Handle */}
      {hasSourceHandle && (
        <Handle
          type="source"
          position={sourceHandlePosition}
          style={{
            width: 10,
            height: 10,
            background: sourceHandleColor,
            border: "2px solid #FFFFFF",
            boxShadow: "0 0 6px rgba(0, 0, 0, 0.18)",
          }}
        />
      )}
    </div>
  );
}
