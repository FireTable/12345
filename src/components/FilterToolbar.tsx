import React from "react";
import { Search, SlidersHorizontal, AlertCircle } from "lucide-react";
import type { RiskLevel } from "../types";

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
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索主体、地点、工单号或关键词..."
          className="w-full bg-slate-900/90 border border-slate-800 focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/50 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 transition-all outline-none"
        />
      </div>

      {/* Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3" />
          风险等级：
        </span>

        <button
          onClick={() => onRiskChange("ALL")}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            selectedRisk === "ALL"
              ? "bg-slate-700 text-white shadow-sm"
              : "bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800"
          }`}
        >
          全部
        </button>

        <button
          onClick={() => onRiskChange("HIGH")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            selectedRisk === "HIGH"
              ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
              : "bg-rose-950/40 text-rose-300 border border-rose-900/50 hover:bg-rose-900/50"
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
          🔴 高风险
        </button>

        <button
          onClick={() => onRiskChange("MEDIUM")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            selectedRisk === "MEDIUM"
              ? "bg-amber-600 text-white shadow-md shadow-amber-600/30"
              : "bg-amber-950/40 text-amber-300 border border-amber-900/50 hover:bg-amber-900/50"
          }`}
        >
          🟡 中风险
        </button>

        <button
          onClick={() => onRiskChange("LOW")}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
            selectedRisk === "LOW"
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
              : "bg-emerald-950/40 text-emerald-300 border border-emerald-900/50 hover:bg-emerald-900/50"
          }`}
        >
          🟢 常规关注
        </button>

        {/* Category dropdown */}
        <select
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="bg-slate-900/90 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1 outline-none focus:border-cyan-500"
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
