"use client";

import React from "react";
import { Search } from "lucide-react";
import type { RiskLevel } from "@/backend/state";
import { Input } from "@/app/_components/ui/input";
import { Button } from "@/app/_components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索主体、地点、工单号或关键词..."
          className="pl-8 text-xs h-8.5 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500 shadow-2xs"
        />
      </div>

      {/* Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
        <span className="text-xs text-slate-500 font-medium">
          风险等级：
        </span>

        <Button
          size="sm"
          variant={selectedRisk === "ALL" ? "secondary" : "outline"}
          onClick={() => onRiskChange("ALL")}
          className={`h-7.5 text-xs ${
            selectedRisk === "ALL"
              ? "bg-slate-900 text-white hover:bg-slate-800"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          全部
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("HIGH")}
          className={`h-7.5 text-xs ${
            selectedRisk === "HIGH"
              ? "bg-rose-50 text-rose-700 border-rose-300 font-semibold"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          🔴 紧急督办
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("MEDIUM")}
          className={`h-7.5 text-xs ${
            selectedRisk === "MEDIUM"
              ? "bg-amber-50 text-amber-700 border-amber-300 font-semibold"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          🟡 重点跟进
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => onRiskChange("LOW")}
          className={`h-7.5 text-xs ${
            selectedRisk === "LOW"
              ? "bg-slate-100 text-slate-800 border-slate-300 font-semibold"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          ⚪ 常规流转
        </Button>

        {/* Category dropdown */}
        <Select
          value={selectedCategory}
          onValueChange={(val) => onCategoryChange(val)}
        >
          <SelectTrigger className="w-[125px] h-7.5 bg-white border-slate-300 text-xs text-slate-700 rounded-md shadow-2xs">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部分类</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
