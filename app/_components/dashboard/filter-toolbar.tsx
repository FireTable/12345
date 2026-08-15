"use client";

import React from "react";
import { Search } from "lucide-react";
import type { RiskLevel } from "@/backend/state";
import { Input } from "@/app/_components/ui/input";
import { Button } from "@/app/_components/ui/button";

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索主体、地点、工单号或关键词..."
          className="pl-8 text-xs h-8 bg-zinc-900 border-zinc-800 text-zinc-200"
        />
      </div>

      {/* Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
        <span className="text-xs text-zinc-500">
          风险等级：
        </span>

        <Button
          size="sm"
          variant={selectedRisk === "ALL" ? "secondary" : "outline"}
          onClick={() => onRiskChange("ALL")}
          className="h-7 text-xs border-zinc-800 bg-zinc-900"
        >
          全部
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("HIGH")}
          className={`h-7 text-xs border-zinc-800 ${
            selectedRisk === "HIGH"
              ? "bg-red-950/80 text-red-300 border-red-900"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          紧急督办
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("MEDIUM")}
          className={`h-7 text-xs border-zinc-800 ${
            selectedRisk === "MEDIUM"
              ? "bg-amber-950/80 text-amber-300 border-amber-900"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          重点跟进
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("LOW")}
          className={`h-7 text-xs border-zinc-800 ${
            selectedRisk === "LOW"
              ? "bg-zinc-800 text-zinc-200"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          常规流转
        </Button>

        {/* Category dropdown */}
        <select
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 rounded-md px-2.5 py-1 outline-none h-7 focus:border-zinc-700"
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
