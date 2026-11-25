"use client";

import React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "blue" | "green" | "purple" | "orange" | "red" | "cyan" | "default";

export interface StatCardProps {
  label: string;
  value: number | string | undefined | null;
  sub?: React.ReactNode;
  icon?: LucideIcon | React.ReactNode;
  tone?: StatTone;
  href?: string;
  onClick?: () => void;
  badge?: string;
  className?: string;
  valueClassName?: string;
}

const TONE_STYLES: Record<StatTone, { iconBg: string; iconColor: string; border: string }> = {
  blue: {
    iconBg: "bg-blue-50/90 text-blue-600 border-blue-100/80",
    iconColor: "text-blue-600",
    border: "group-hover:border-blue-200/80",
  },
  green: {
    iconBg: "bg-emerald-50/90 text-emerald-600 border-emerald-100/80",
    iconColor: "text-emerald-600",
    border: "group-hover:border-emerald-200/80",
  },
  purple: {
    iconBg: "bg-purple-50/90 text-purple-600 border-purple-100/80",
    iconColor: "text-purple-600",
    border: "group-hover:border-purple-200/80",
  },
  orange: {
    iconBg: "bg-amber-50/90 text-amber-600 border-amber-100/80",
    iconColor: "text-amber-600",
    border: "group-hover:border-amber-200/80",
  },
  red: {
    iconBg: "bg-rose-50/90 text-rose-600 border-rose-100/80",
    iconColor: "text-rose-600",
    border: "group-hover:border-rose-200/80",
  },
  cyan: {
    iconBg: "bg-cyan-50/90 text-cyan-600 border-cyan-100/80",
    iconColor: "text-cyan-600",
    border: "group-hover:border-cyan-200/80",
  },
  default: {
    iconBg: "bg-slate-100 text-slate-600 border-slate-200/80",
    iconColor: "text-slate-600",
    border: "group-hover:border-slate-300",
  },
};

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "blue",
  href,
  onClick,
  badge,
  className,
  valueClassName,
}: StatCardProps) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.default;
  const isInteractive = Boolean(href || onClick);

  const formattedValue =
    typeof value === "number"
      ? value.toLocaleString("zh-CN")
      : value !== undefined && value !== null
      ? String(value)
      : "0";

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return icon;
    }
    const IconComp = icon as React.ElementType;
    return <IconComp className="w-5 h-5" />;
  };

  const cardContent = (
    <div
      className={cn(
        "relative flex items-center gap-2.5 sm:gap-3.5 p-3 sm:p-4 rounded-xl border border-[var(--c-border-card,rgba(15,23,42,0.08))] bg-[var(--c-surface)] shadow-[var(--sh-1)] transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none min-w-0",
        isInteractive && "cursor-pointer group hover:shadow-[var(--sh-2)] hover:border-[var(--c-border)] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        styles.border,
        className
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            "w-9 h-9 sm:w-10.5 sm:h-10.5 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            styles.iconBg,
            isInteractive && "group-hover:scale-105 motion-reduce:group-hover:scale-100"
          )}
        >
          {renderIcon()}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-1 min-w-0">
          <span className="text-xs font-medium text-[var(--c-ink-3)] truncate">{label}</span>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--c-bg)] text-[var(--c-ink-3)] border border-[var(--c-border-soft)] shrink-0 whitespace-nowrap">
              {badge}
            </span>
          )}
        </div>

        <div
          className={cn(
            "text-[clamp(1.0625rem,0.92rem+0.8vw,1.375rem)] font-bold font-sans tabular-nums whitespace-nowrap tracking-tight text-[var(--c-ink)] leading-tight",
            valueClassName
          )}
        >
          {formattedValue}
        </div>

        {sub && (
          <div className="text-[11px] text-[var(--c-ink-3)] mt-1 truncate">
            {sub}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block no-underline rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--c-brand)] focus-visible:outline-offset-2 min-w-0"
      >
        {cardContent}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left bg-transparent border-0 p-0 rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--c-brand)] focus-visible:outline-offset-2 min-w-0"
      >
        {cardContent}
      </button>
    );
  }

  return cardContent;
}

export function StatCardGrid({
  children,
  columns = 4,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  const colClass =
    columns === 4
      ? "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5 mb-4"
      : columns === 3
      ? "grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-3.5 mb-4"
      : columns === 5
      ? "grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-3.5 mb-4"
      : "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5 mb-4";

  return <section className={cn(colClass, className)}>{children}</section>;
}
