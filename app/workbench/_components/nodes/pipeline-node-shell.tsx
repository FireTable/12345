"use client";

import React from "react";
import { Handle, Position } from "@xyflow/react";

export type PipelineNodeStatus = "idle" | "running" | "completed";

export interface PipelineNodeShellProps {
  stepNumber: string; // e.g. "01", "02"
  title: string;
  icon: React.ReactNode;
  iconGradient?: string;
  status: PipelineNodeStatus;
  statusText?: string;
  hasTargetHandle?: boolean;
  targetHandleColor?: string;
  hasSourceHandle?: boolean;
  sourceHandleColor?: string;
  children: React.ReactNode;
}

export function PipelineNodeShell({
  stepNumber,
  title,
  icon,
  iconGradient = "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
  status,
  statusText,
  hasTargetHandle = true,
  targetHandleColor = "#3B82F6",
  hasSourceHandle = true,
  sourceHandleColor = "#3B82F6",
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
    >
      {/* 左侧输入连接 Handle */}
      {hasTargetHandle && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            width: 10,
            height: 10,
            background: targetHandleColor,
            border: "2px solid #FFFFFF",
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
          className="pipeline-node__tag"
          style={{
            background: isActive ? "#EFF6FF" : isCompleted ? "#F0FDF4" : "#F1F5F9",
            color: isActive ? "#2563EB" : isCompleted ? "#16A34A" : "#64748B",
            borderColor: isActive ? "#BFDBFE" : isCompleted ? "#BBF7D0" : "#E2E8F0",
          }}
        >
          {tagLabel}
        </span>
      </div>

      {/* 节点主体内容插槽：严格统一 padding 和间距 */}
      <div className="pipeline-node__body">{children}</div>

      {/* 右侧输出连接 Handle */}
      {hasSourceHandle && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            width: 10,
            height: 10,
            background: sourceHandleColor,
            border: "2px solid #FFFFFF",
          }}
        />
      )}
    </div>
  );
}
