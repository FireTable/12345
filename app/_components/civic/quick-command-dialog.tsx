"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Bot,
  CornerDownLeft,
  Cpu,
  FlaskConical,
  Globe2,
  Layers,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Monitor,
  Search,
  Send,
  X,
} from "lucide-react";

export interface QuickCommandDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenCopilot: () => void;
  onTogglePipeline: () => void;
  isEcommerce: boolean;
}

type CommandGroup = "ai" | "workspace" | "system";

interface CommandItem {
  id: string;
  group: CommandGroup;
  title: string;
  description: string;
  hint: string;
  aliases: string[];
  icon: React.ReactNode;
  href?: string;
  onSelect?: () => void;
}

const GROUP_LABELS: Record<CommandGroup, string> = {
  ai: "AI 工具与流水线",
  workspace: "核心工作台",
  system: "系统配置与端侧预览",
};

const GROUP_ORDER: CommandGroup[] = ["ai", "workspace", "system"];

function isPointerOutsideDialog(
  e: React.PointerEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement
) {
  const r = dialog.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

export function QuickCommandDialog({
  isOpen,
  onClose,
  onOpenCopilot,
  onTogglePipeline,
  isEcommerce,
}: QuickCommandDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pressedOutsideRef = useRef(false);

  const titleId = useId();
  const inputId = useId();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo<CommandItem[]>(
    () => [
      {
        id: "copilot",
        group: "ai",
        title: isEcommerce ? "AI 客诉聊天框 / 副驾驶" : "AI 研判聊天框 / 副驾驶",
        description: isEcommerce
          ? "打开对话式 AI 客诉研判助手，实时问答与处置建议"
          : "打开对话式 AI 研判助手，实时问答与工单剖析",
        hint: "直接打开",
        aliases: ["ai", "研判", "客诉", "聊天框", "对话", "助手", "副驾驶", "copilot", "问答"],
        icon: <MessageCircle size={16} aria-hidden="true" />,
        onSelect: onOpenCopilot,
      },
      {
        id: "pipeline",
        group: "ai",
        title: isEcommerce ? "AI 客诉聚类流水线" : "算力聚类流水线",
        description: "展开/收起顶部 AI 研判流水线控制台与实时任务进度",
        hint: "切换控制台",
        aliases: ["流水线", "聚类", "任务", "进度", "pipeline", "算力", "控制台"],
        icon: <Cpu size={16} aria-hidden="true" />,
        onSelect: onTogglePipeline,
      },
      {
        id: "dashboard",
        group: "workspace",
        title: "数据总览",
        description: isEcommerce
          ? "全渠道客诉实时态势、关键指标与热点分布"
          : "全区实时工单统计、热点地图与核心指标驾驶舱",
        hint: "/",
        aliases: ["/", "总览", "首页", "驾驶舱", "统计", "dashboard", "看板"],
        icon: <LayoutDashboard size={16} aria-hidden="true" />,
        href: "/",
      },
      {
        id: "multifreq",
        group: "workspace",
        title: isEcommerce ? "多频客诉与透势" : "多频工单",
        description: isEcommerce
          ? "高频重复客诉聚类、四象限研判与假闭环追踪"
          : "多频重复工单透势分析、四象限研判与假闭环追踪",
        hint: "/multifreq",
        aliases: ["/multifreq", "多频", "聚类", "重复", "高频", "透势", "四象限", "假闭环", "multifreq"],
        icon: <Activity size={16} aria-hidden="true" />,
        href: "/multifreq",
      },
      {
        id: "themes",
        group: "workspace",
        title: isEcommerce ? "专题客诉事件" : "专题事件",
        description: isEcommerce
          ? "热点客诉专题聚合、实体拓扑与批量处置建议"
          : "专题热点事件聚合、实体拓扑与公文级处置建议",
        hint: "/themes",
        aliases: ["/themes", "专题", "事件", "热点", "多频", "主题", "群组", "themes"],
        icon: <Layers size={16} aria-hidden="true" />,
        href: "/themes",
      },
      {
        id: "screen",
        group: "workspace",
        title: isEcommerce ? "客诉透势大屏" : "工单透势大屏",
        description: isEcommerce
          ? "全渠道实时指挥大屏、热力分布与态势总览"
          : "实时指挥调度大屏、地理态势与热力图",
        hint: "/screen",
        aliases: ["/screen", "大屏", "地图", "透势", "态势", "热力图", "指挥", "screen"],
        icon: <Monitor size={16} aria-hidden="true" />,
        href: "/screen",
      },
      {
        id: "tickets",
        group: "workspace",
        title: isEcommerce ? "客诉工单中心" : "工单中心",
        description: isEcommerce
          ? "全量售后工单检索、缺资料补全与假闭环核查"
          : "全量工单列表检索、缺资料核查与假闭环明细",
        hint: "/tickets",
        aliases: ["/tickets", "工单", "列表", "缺资料", "假闭环", "搜索", "核查", "tickets"],
        icon: <ListChecks size={16} aria-hidden="true" />,
        href: "/tickets",
      },
      {
        id: "agent",
        group: "workspace",
        title: "智能治理与 AI 外呼",
        description: "主动巡检待办、AI 语音外呼补全、48h 回访、红线与专报",
        hint: "/agent",
        aliases: ["/agent", "治理", "外呼", "电话", "巡检", "待办", "回访", "红线", "专报", "agent"],
        icon: <Bot size={16} aria-hidden="true" />,
        href: "/agent",
      },
      {
        id: "dict",
        group: "system",
        title: "知识词典",
        description: "标准分类字典、同义词对齐与实体别名白名单",
        hint: "/dict",
        aliases: ["/dict", "词典", "词库", "同义词", "别名", "标准字典", "白名单", "dict"],
        icon: <BookOpen size={16} aria-hidden="true" />,
        href: "/dict",
      },
      {
        id: "sandbox",
        group: "system",
        title: "研判沙盒",
        description: "实时 AI 透视测试、PII 脱敏防火墙与 ONNX X-Ray 演练",
        hint: "/sandbox",
        aliases: ["/sandbox", "沙盒", "测试", "脱敏", "onnx", "xray", "演练", "sandbox"],
        icon: <FlaskConical size={16} aria-hidden="true" />,
        href: "/sandbox",
      },
      {
        id: "regions",
        group: "system",
        title: isEcommerce ? "多品牌站点管理" : "多站点管理",
        description: isEcommerce
          ? "品牌租户隔离、算力节点状态与站点配置"
          : "区域租户管理、算力节点与地理边界配置",
        hint: "/admin/regions",
        aliases: ["/admin/regions", "站点", "区域", "租户", "算力节点", "地图", "品牌", "regions"],
        icon: <Globe2 size={16} aria-hidden="true" />,
        href: "/admin/regions",
      },
      {
        id: "submit",
        group: "system",
        title: isEcommerce ? "买家投诉端预览" : "市民投诉端预览",
        description: isEcommerce
          ? "预览买家售后客诉填报与实时受理表单"
          : "预览市民诉求填报提交界面与实时受理流程",
        hint: "/submit",
        aliases: ["/submit", "市民", "买家", "投诉", "客诉", "填报", "提交", "预览", "submit"],
        icon: <Send size={16} aria-hidden="true" />,
        href: "/submit",
      },
    ],
    [isEcommerce, onOpenCopilot, onTogglePipeline]
  );

  const filteredItems = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return items;
    return items.filter((item) => {
      const haystack = [
        item.title,
        item.description,
        item.hint,
        GROUP_LABELS[item.group],
        ...item.aliases,
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, query]);

  const groupedSections = useMemo(() => {
    const sections: Array<{ group: CommandGroup; label: string; items: Array<{ item: CommandItem; flatIndex: number }> }> = [];
    let flatIndex = 0;
    for (const group of GROUP_ORDER) {
      const groupItems = filteredItems.filter((it) => it.group === group);
      if (groupItems.length === 0) continue;
      sections.push({
        group,
        label: GROUP_LABELS[group],
        items: groupItems.map((item) => ({ item, flatIndex: flatIndex++ })),
      });
    }
    return sections;
  }, [filteredItems]);

  const safeActiveIndex =
    filteredItems.length === 0 ? -1 : Math.min(activeIndex, filteredItems.length - 1);
  const activeItem = safeActiveIndex >= 0 ? filteredItems[safeActiveIndex] : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
      if (!dialog.open) {
        dialog.showModal();
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen || !activeItem) return;
    optionRefs.current[activeItem.id]?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeItem]);

  const closeDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    } else {
      onClose();
    }
  }, [onClose]);

  const handleSelectItem = useCallback(
    (item: CommandItem) => {
      if (item.href) {
        closeDialog();
        router.push(item.href);
        return;
      }
      if (item.onSelect) {
        const callback = item.onSelect;
        closeDialog();
        requestAnimationFrame(() => {
          callback();
        });
      }
    },
    [closeDialog, router]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredItems.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredItems.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
      return;
    }
    if (e.key === "Home") {
      if (filteredItems.length === 0) return;
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      if (filteredItems.length === 0) return;
      e.preventDefault();
      setActiveIndex(filteredItems.length - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      if (activeItem) {
        handleSelectItem(activeItem);
      }
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="quick-cmd-dialog m-auto w-[min(580px,calc(100dvw-24px))] max-w-none max-h-[85dvh] flex-col rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl overflow-hidden"
      aria-labelledby={titleId}
      {...({ closedby: "any" } as Record<string, string>)}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        if (isOpen) {
          onClose();
        }
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        if (e.pointerType === "mouse" && e.button !== 0) {
          pressedOutsideRef.current = false;
          return;
        }
        pressedOutsideRef.current = isPointerOutsideDialog(e, dialog);
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const shouldClose =
          pressedOutsideRef.current &&
          !(e.pointerType === "mouse" && e.button !== 0) &&
          isPointerOutsideDialog(e, dialog);
        pressedOutsideRef.current = false;
        if (shouldClose) {
          dialog.close();
        }
      }}
      onPointerCancel={() => {
        pressedOutsideRef.current = false;
      }}
    >
      <h1 id={titleId} className="sr-only">
        快速搜索与功能跳转
      </h1>

      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-slate-200/80 bg-white forced-colors:focus-within:outline forced-colors:focus-within:outline-2 forced-colors:focus-within:outline-[Highlight]">
        <Search size={17} className="text-slate-400 shrink-0" aria-hidden="true" />
        <label htmlFor={inputId} className="sr-only">
          搜索页面或工具关键词
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={
            isEcommerce
              ? "搜索功能、客诉页面或工具…（支持中英文）"
              : "搜索功能、页面或 AI 工具…（支持中英文）"
          }
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeItem ? `quick-cmd-opt-${activeItem.id}` : undefined}
          aria-autocomplete="list"
          className="flex-1 min-w-0 bg-transparent text-[14px] text-slate-900 caret-blue-600 placeholder:text-slate-400 focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus({ preventScroll: true });
            }}
            className="relative text-[11px] font-medium px-2 py-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition-colors cursor-pointer shrink-0 after:content-[''] after:absolute after:-inset-y-[11px] after:-inset-x-1"
          >
            清空
          </button>
        ) : null}
        <button
          type="button"
          onClick={closeDialog}
          className="relative flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer shrink-0 after:content-[''] after:absolute after:-inset-[9px]"
          aria-label="关闭快速搜索"
          title="关闭 (ESC)"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label="功能与页面跳转列表"
        className="quick-cmd-dialog__list max-h-[min(420px,62dvh)] overflow-y-auto overscroll-contain p-2"
      >
        {groupedSections.length === 0 ? (
          <div className="py-10 px-4 text-center">
            <p className="text-sm font-medium text-slate-700">
              未找到匹配「{query.trim()}」的功能或页面
            </p>
            <p className="mt-1 text-xs text-slate-500">
              可尝试搜索：研判、流水线、工单、外呼、大屏、词典、沙盒、站点
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus({ preventScroll: true });
              }}
              className="mt-3 inline-flex min-h-[44px] sm:min-h-[38px] items-center justify-center px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              重置搜索条件
            </button>
          </div>
        ) : (
          groupedSections.map((section) => {
            const groupLabelId = `quick-cmd-group-${section.group}`;
            return (
              <div
                key={section.group}
                role="group"
                aria-labelledby={groupLabelId}
                className="mb-2 last:mb-0"
              >
                <div
                  id={groupLabelId}
                  className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500"
                >
                  {section.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {section.items.map(({ item, flatIndex }) => {
                    const isSelected = flatIndex === safeActiveIndex;
                    return (
                      <button
                        key={item.id}
                        id={`quick-cmd-opt-${item.id}`}
                        ref={(el) => {
                          optionRefs.current[item.id] = el;
                        }}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={isSelected}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => handleSelectItem(item)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-slate-100/90 text-slate-900"
                            : "bg-transparent text-slate-700 hover:bg-slate-100/60"
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? "bg-white text-blue-600 shadow-2xs"
                              : "bg-slate-100/80 text-slate-500"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] font-medium leading-snug truncate">
                            {item.title}
                          </span>
                          <span className="block text-[12px] text-slate-500 leading-snug truncate mt-0.5">
                            {item.description}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-[11px] font-mono ${
                              isSelected ? "text-slate-600" : "text-slate-400"
                            }`}
                          >
                            {item.hint}
                          </span>
                          {isSelected ? (
                            <CornerDownLeft
                              size={13}
                              className="text-slate-400 shrink-0"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-200 bg-slate-50/90 text-[11px] text-slate-500">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-slate-600">
              ↑↓
            </kbd>
            <span>选择</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-slate-600">
              ↵
            </kbd>
            <span>打开 / 跳转</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-slate-600">
              ESC
            </kbd>
            <span>关闭</span>
          </span>
        </div>
        <span
          className="font-mono tabular-nums text-slate-600 shrink-0"
          aria-live="polite"
          aria-atomic="true"
        >
          {filteredItems.length === 0
            ? "无匹配结果"
            : query.trim()
            ? `匹配 ${filteredItems.length} 项`
            : `共 ${filteredItems.length} 项`}
        </span>
      </div>
    </dialog>
  );
}
