"use client";

import React from "react";

export interface CockpitCardProps {
  children: React.ReactNode;
  variant?: "default" | "danger" | "purple" | "emerald";
  className?: string;
  header?: React.ReactNode;
}

/**
 * 统一管理的数据大屏半透明液态玻璃卡片容器
 * 统一卡片底色透明度、毛玻璃模糊、边缘流体反光与主题光晕
 */
export function CockpitCard({
  children,
  variant = "default",
  className = "",
  header,
}: CockpitCardProps) {
  const variantClass =
    variant === "danger"
      ? "cockpit-glass-card--danger"
      : variant === "purple"
      ? "cockpit-glass-card--purple"
      : variant === "emerald"
      ? "cockpit-glass-card--emerald"
      : "";

  return (
    <div
      className={`cockpit-glass-card ${variantClass} w-full h-full flex flex-col p-3.5 sm:p-4 ${className}`}
    >
      {header && (
        <div className="cockpit-glass-header pb-2 mb-2.5 flex items-center justify-between shrink-0">
          {header}
        </div>
      )}
      {children}
    </div>
  );
}
