"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

export type TablePagerProps = {
  page: number;
  pages: number;
  total: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  itemLabel?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
};

function pageItems(page: number, pages: number): Array<number | "ellipsis"> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }
  const marks = new Set<number>([1, pages, page, page - 1, page + 1]);
  if (page <= 3) {
    marks.add(2);
    marks.add(3);
    marks.add(4);
  }
  if (page >= pages - 2) {
    marks.add(pages - 1);
    marks.add(pages - 2);
    marks.add(pages - 3);
  }
  const nums = [...marks].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > 0 && nums[i] - nums[i - 1] > 1) out.push("ellipsis");
    out.push(nums[i]);
  }
  return out;
}

export function TablePager({
  page,
  pages,
  total,
  pageSize,
  pageSizeOptions,
  itemLabel = "条",
  onPageChange,
  onPageSizeChange,
}: TablePagerProps) {
  const safePages = Math.max(1, pages);
  const safePage = Math.min(Math.max(1, page), safePages);
  const size = pageSize && pageSize > 0 ? pageSize : 10;
  const start = total === 0 ? 0 : (safePage - 1) * size + 1;
  const end = Math.min(safePage * size, total);
  const [jump, setJump] = useState(String(safePage));

  useEffect(() => {
    setJump(String(safePage));
  }, [safePage]);

  function go(next: number) {
    const clamped = Math.min(safePages, Math.max(1, next));
    if (clamped !== page) onPageChange(clamped);
  }

  function commitJump() {
    go(Number(jump) || 1);
  }

  const items = pageItems(safePage, safePages);

  return (
    <div className="pagination">
      <div className="pagination__info">
        共 <b>{total.toLocaleString("zh-CN")}</b> {itemLabel} · 当前{" "}
        <b>
          {start}-{end}
        </b>
      </div>
      <div className="pagination__controls">
        {pageSizeOptions && pageSizeOptions.length > 0 && onPageSizeChange ? (
          <Select
            value={String(size)}
            onValueChange={(val) => onPageSizeChange(Number(val))}
          >
            <SelectTrigger className="w-[88px] h-[30px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] rounded-md font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}/页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <button type="button" className="page-btn" disabled={safePage <= 1} onClick={() => go(1)} aria-label="第一页">
          «
        </button>
        <button
          type="button"
          className="page-btn"
          disabled={safePage <= 1}
          onClick={() => go(safePage - 1)}
          aria-label="上一页"
        >
          ‹
        </button>
        {items.map((item, idx) =>
          item === "ellipsis" ? (
            <span key={`e-${idx}`} className="page-btn page-btn--ellipsis" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`page-btn${item === safePage ? " is-active" : ""}`}
              onClick={() => go(item)}
              aria-current={item === safePage ? "page" : undefined}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          className="page-btn"
          disabled={safePage >= safePages}
          onClick={() => go(safePage + 1)}
          aria-label="下一页"
        >
          ›
        </button>
        <button
          type="button"
          className="page-btn"
          disabled={safePage >= safePages}
          onClick={() => go(safePages)}
          aria-label="最后一页"
        >
          »
        </button>
        <span className="page-jump">
          跳至
          <input
            type="number"
            min={1}
            max={safePages}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitJump();
            }}
            onBlur={commitJump}
          />
          / {safePages} 页
        </span>
      </div>
    </div>
  );
}
