"use client";

import React from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { RiskLevel } from "@/backend/state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FilterToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedRisk: RiskLevel | "ALL";
  onRiskChange: (r: RiskLevel | "ALL") => void;
  selectedCategory: string;
  onCategoryChange: (c: string) => void;
  categories: string[];
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  searchQuery,
  onSearchChange,
  selectedRisk,
  onRiskChange,
  selectedCategory,
  onCategoryChange,
  categories,
}) => {
  return (
    <div className="max-w-7xl mx-auto px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3">
      {/* Search Input */}
      <div className="relative w-full md:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索主体、地点、工单号或关键词..."
          className="pl-9 text-xs"
        />
      </div>

      {/* Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3" />
          风险等级：
        </span>

        <Button
          size="sm"
          variant={selectedRisk === "ALL" ? "secondary" : "outline"}
          onClick={() => onRiskChange("ALL")}
          className="h-7 text-xs"
        >
          全部
        </Button>

        <Button
          size="sm"
          variant={selectedRisk === "HIGH" ? "destructive" : "outline"}
          onClick={() => onRiskChange("HIGH")}
          className="h-7 text-xs border-rose-900/50 text-rose-300 hover:bg-rose-900/40"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
          🔴 高风险
        </Button>

        <Button
          size="sm"
          variant={selectedRisk === "MEDIUM" ? "default" : "outline"}
          onClick={() => onRiskChange("MEDIUM")}
          className={`h-7 text-xs border-amber-900/50 text-amber-300 hover:bg-amber-900/40 ${
            selectedRisk === "MEDIUM" ? "bg-amber-600 text-white" : ""
          }`}
        >
          🟡 中风险
        </Button>

        <Button
          size="sm"
          variant={selectedRisk === "LOW" ? "emerald" : "outline"}
          onClick={() => onRiskChange("LOW")}
          className="h-7 text-xs border-emerald-900/50 text-emerald-300 hover:bg-emerald-900/40"
        >
          🟢 常规关注
        </Button>

        {/* Category dropdown */}
        <select
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="bg-slate-900/90 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1 outline-none focus:border-cyan-500 h-7"
        >
          <option value="ALL">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
