"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Layers,
  TrendingUp,
  ShieldAlert,
  Brain,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Clock,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ShieldCheck,
  Building2,
  Server,
  Headphones,
  Briefcase,
  Users,
  Database,
  ArrowRight,
  Sparkle,
  Cpu,
  FileText,
  FileSearch,
  Zap,
} from "lucide-react";
import Link from "next/link";

export default function PresentationPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(300); // 5 minutes
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  // Interactive slide states
  const [isFolded, setIsFolded] = useState(false);
  const [sentinelTriggered, setSentinelTriggered] = useState(false);
  const [aliasInput, setAliasInput] = useState("容奇大桥脚");

  const totalSlides = 12;

  // Keyboard navigation
  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev < totalSlides - 1 ? prev + 1 : prev));
  }, [totalSlides]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        nextSlide();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevSlide();
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextSlide, prevSlide]);

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="relative w-screen h-screen bg-slate-950 text-slate-100 overflow-hidden select-none font-sans flex flex-col justify-between">
      {/* Background Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-[160px] pointer-events-none" />

      {/* Top Bar */}
      <header className="relative z-20 flex items-center justify-between px-8 py-4 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="px-2.5 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-black text-sm tracking-wider rounded shadow-sm shadow-blue-500/30">
            12345
          </div>
          <span className="font-bold text-lg bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            民声智理 · 顺德 12345 AI 智能研判系统
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 font-medium">
            赢了就回家吃鱼生 团队
          </span>
        </div>

        {/* Center: Slide Progress Pill */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-full border border-slate-800 shadow-inner">
          {Array.from({ length: totalSlides }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all duration-300 ${
                idx === currentSlide
                  ? "w-6 bg-blue-500 shadow-sm shadow-blue-400"
                  : idx < currentSlide
                  ? "w-2 bg-slate-600"
                  : "w-2 bg-slate-800"
              }`}
              title={`跳转到第 ${idx + 1} 页`}
            />
          ))}
          <span className="text-xs font-mono text-slate-400 ml-2">
            {currentSlide + 1} / {totalSlides}
          </span>
        </div>

        {/* Right: Controls & Timer */}
        <div className="flex items-center gap-3">
          {/* Timer Tool */}
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-900/90 border border-slate-800 rounded-lg text-xs font-mono">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span
              className={`font-semibold ${
                timerSeconds < 60 ? "text-red-400 animate-pulse" : "text-slate-200"
              }`}
            >
              {formatTime(timerSeconds)}
            </span>
            <button
              onClick={() => setIsTimerRunning(!isTimerRunning)}
              className="text-[10px] px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded ml-1 transition"
            >
              {isTimerRunning ? "暂停" : "计时"}
            </button>
            <button
              onClick={() => {
                setIsTimerRunning(false);
                setTimerSeconds(300);
              }}
              title="重置5分钟"
              className="text-slate-400 hover:text-slate-200"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition"
            title="全屏切换 (F)"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <Link
            href="/"
            className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
          >
            返回控制台
          </Link>
        </div>
      </header>

      {/* Main Slide Stage */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6 md:p-12 overflow-hidden">
        <AnimatePresence mode="wait">
          {currentSlide === 0 && <Slide1 key="slide-1" />}
          {currentSlide === 1 && <Slide2 key="slide-2" />}
          {currentSlide === 2 && <Slide3 key="slide-3" />}
          {currentSlide === 3 && (
            <Slide4 key="slide-4" isFolded={isFolded} setIsFolded={setIsFolded} />
          )}
          {currentSlide === 4 && <Slide5 key="slide-5" />}
          {currentSlide === 5 && (
            <Slide6
              key="slide-6"
              sentinelTriggered={sentinelTriggered}
              setSentinelTriggered={setSentinelTriggered}
            />
          )}
          {currentSlide === 6 && <Slide7 key="slide-7" />}
          {currentSlide === 7 && (
            <Slide8
              key="slide-8"
              aliasInput={aliasInput}
              setAliasInput={setAliasInput}
            />
          )}
          {currentSlide === 8 && <Slide9 key="slide-9" />}
          {currentSlide === 9 && <Slide10 key="slide-10" />}
          {currentSlide === 10 && <Slide11 key="slide-11" />}
          {currentSlide === 11 && <Slide12 key="slide-12" />}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation Bar */}
      <footer className="relative z-20 flex items-center justify-between px-8 py-3.5 border-t border-slate-800/80 bg-slate-950/70 backdrop-blur-md">
        <div className="text-xs text-slate-400 flex items-center gap-4">
          <span>
            快捷键：<kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[10px]">Space</kbd> / <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[10px]">←</kbd> <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[10px]">→</kbd> 翻页
          </span>
          <span>
            全屏：<kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 font-mono text-[10px]">F</kbd>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition shadow"
          >
            <ChevronLeft className="w-4 h-4" /> 上一页
          </button>
          <button
            onClick={nextSlide}
            disabled={currentSlide === totalSlides - 1}
            className="flex items-center gap-1.5 px-5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-30 disabled:pointer-events-none text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-500/20 transition"
          >
            下一页 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}

// -------------------------------------------------------------
// Slide 1: 封面
// -------------------------------------------------------------
function Slide1() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      className="w-full max-w-5xl text-center flex flex-col items-center justify-center space-y-6"
    >
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-medium shadow-inner"
      >
        <Sparkles className="w-4 h-4" /> 企业赛道：12345 热线多频工单智能识别
      </motion.div>

      <motion.h1
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 120 }}
        className="text-5xl md:text-7xl font-extrabold tracking-tight"
      >
        民声<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400">“智”</span>理
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-2xl md:text-3xl text-slate-300 font-medium tracking-wide"
      >
        顺德 12345 AI 智能研判系统
      </motion.p>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg md:text-xl text-blue-400/90 font-mono italic tracking-wider py-2"
      >
        “从 12345，到 54321。把问题做减法，把民心做加法。”
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex items-center gap-6 pt-4 text-sm text-slate-400 border-t border-slate-800/80"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-500">参赛团队：</span>
          <span className="font-semibold text-slate-200">赢了就回家吃鱼生</span>
        </div>
        <div className="h-4 w-px bg-slate-800" />
        <div className="flex items-center gap-2">
          <span className="text-slate-500">口号：</span>
          <span className="text-cyan-400 font-medium">捞起捞起，风生水起！</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 2: 痛点与破局
// -------------------------------------------------------------
function Slide2() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-8"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl md:text-4xl font-extrabold text-white">
          每天 1800+ 工单涌入，基层热线面临 <span className="text-red-400">四大断层痛点</span>
        </h2>
        <p className="text-slate-400">海量孤立的工单流水，淹没了真正的治理核心事件</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-red-500/20 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-3 mb-2 text-red-400 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-sm border border-red-500/30">01</span>
            诉求淹没 · 聚类难
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            同一事件被多人用不同口语（如“容奇”、“桂洲”）反复投诉，分散在不同工单流水，难以秒级自动聚拢。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-amber-500/20 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-3 mb-2 text-amber-400 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm border border-amber-500/30">02</span>
            数字办结 · 假闭环
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            统计办结率 99%，但同一门牌同因在 48h 内再次投诉复发，缺乏穿透监管机制，形成“敷衍办结”真空。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-blue-500/20 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-3 mb-2 text-blue-400 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-sm border border-blue-500/30">03</span>
            粗放处置 · 套话多
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            大量派单建议全篇千篇一律为“现场核实并处理”，缺少精准牵头科室、响应时限与法定处置路径。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/80 border border-purple-500/20 shadow-lg relative overflow-hidden">
          <div className="flex items-center gap-3 mb-2 text-purple-400 font-bold text-lg">
            <span className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm border border-purple-500/30">04</span>
            模型幻觉 · 不敢用
          </div>
          <p className="text-slate-300 text-sm leading-relaxed">
            通用大模型极易虚构不存在的行政镇街或机构名称，政务严肃场景“零容错”，传统 AI 难以直上生产。
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-between text-blue-200 text-sm">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-cyan-400 shrink-0" />
          <span><b>民声智理破局核心</b>：通过 LangGraph 图工作流，将 <b>1800+ 碎片流水</b> 降维聚合成 <b>几十个核心治理群组</b>！</span>
        </div>
        <span className="text-xs px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 font-mono shrink-0">降维减负 95%</span>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 3: 四大功能全景
// -------------------------------------------------------------
function Slide3() {
  const features = [
    {
      num: "01",
      name: "折叠功能",
      sub: "双轨多频识别与秒级聚合",
      desc: "主体 100% 字符对齐 + 微地点时空拓扑聚拢，同类问题一次派单、彻底根治。",
      icon: Layers,
      color: "from-blue-500 to-cyan-500",
      border: "border-blue-500/30",
    },
    {
      num: "02",
      name: "透势功能",
      sub: "时序演化与激化态势预警",
      desc: "实时感知辖区诉求环比激化态势，结合紧急×重要四象限，防患于未然。",
      icon: TrendingUp,
      color: "from-cyan-500 to-emerald-500",
      border: "border-cyan-500/30",
    },
    {
      num: "03",
      name: "哨兵功能",
      sub: "72 小时假闭环穿透狙击",
      desc: "办结后短时间复发自动标红告警，跳过普通流程直推督查督办函。",
      icon: ShieldAlert,
      color: "from-amber-500 to-red-500",
      border: "border-red-500/30",
    },
    {
      num: "04",
      name: "记忆功能",
      sub: "公文级处置建议与自进化",
      desc: "结合权责清单给出牵头/协办/时限，自学习新别名并沉淀至权威知识库。",
      icon: Brain,
      color: "from-purple-500 to-indigo-500",
      border: "border-purple-500/30",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl md:text-4xl font-extrabold text-white">
          民声智理 · <span className="text-cyan-400">四大核心功能矩阵</span>
        </h2>
        <p className="text-slate-400">不是简单分类，而是实现从“被动接听”到“主动督办”的全链路闭环</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
        {features.map((f, idx) => {
          const Icon = f.icon;
          return (
            <motion.div
              key={idx}
              whileHover={{ y: -4, scale: 1.01 }}
              className={`p-6 rounded-2xl bg-slate-900/90 border ${f.border} shadow-xl flex flex-col justify-between relative overflow-hidden group`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white shadow-lg`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">{f.num}</span>
                      {f.name}
                    </h3>
                    <p className="text-xs text-cyan-400 font-medium">{f.sub}</p>
                  </div>
                </div>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{f.desc}</p>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 4: 01【折叠功能】互动演示
// -------------------------------------------------------------
function Slide4({
  isFolded,
  setIsFolded,
}: {
  isFolded: boolean;
  setIsFolded: (v: boolean) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono px-2.5 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full font-bold">
            功能 01 · 核心实操
          </span>
          <h2 className="text-3xl font-extrabold text-white mt-2">
            【折叠功能】多频工单智能识别与一键聚拢
          </h2>
        </div>

        <button
          onClick={() => setIsFolded(!isFolded)}
          className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg flex items-center gap-2 ${
            isFolded
              ? "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
              : "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-blue-500/30 hover:brightness-110 animate-pulse"
          }`}
        >
          <Layers className="w-4 h-4" />
          {isFolded ? "重置为 12 条分散工单" : "👉 点击执行：一键 AI 智能折叠"}
        </button>
      </div>

      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 shadow-2xl relative min-h-[340px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          {!isFolded ? (
            <motion.div
              key="unfolded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full grid grid-cols-2 md:grid-cols-3 gap-3"
            >
              {[
                "工单1: 清晖路农商银行门口粤X88888违停霸占消防通道",
                "工单2: 清晖路段黑色小车粤X·88888堵路半天无人管",
                "工单3: 农商行附近粤X88888再次乱停，影响通行",
                "工单4: 粤X88888屡次在新桂中路违章停车",
                "工单5: 大良东区清晖路车牌粤X88888违停请求拖走",
                "工单6: 同一辆粤X88888小车在路口违停堵塞救护通道",
              ].map((text, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-slate-300 space-y-1.5 shadow"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>#250101000{i + 1}</span>
                    <span className="text-amber-400/80">待研判</span>
                  </div>
                  <p className="line-clamp-2">{text}</p>
                </div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="folded"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl p-6 rounded-2xl bg-gradient-to-br from-blue-950/80 to-slate-900 border-2 border-blue-500/50 shadow-2xl shadow-blue-500/20"
            >
              <div className="flex items-center justify-between border-b border-blue-500/30 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs font-bold font-mono">
                    主体型多频群组
                  </span>
                  <span className="text-sm font-bold text-white">
                    大良街道清晖路粤X88888违停反复阻路事件
                  </span>
                </div>
                <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-bold border border-red-500/30">
                  ⚡ 聚合 12 件工单
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400">标准责任主体：</span>
                  <p className="font-bold text-cyan-300 font-mono text-sm mt-0.5">粤X88888 (100%字符精确对齐)</p>
                </div>
                <div>
                  <span className="text-slate-400">时空聚类范围：</span>
                  <p className="text-slate-200 mt-0.5">大良街道清晖路与新桂中路段</p>
                </div>
                <div>
                  <span className="text-slate-400">研判置信度：</span>
                  <p className="text-emerald-400 font-bold mt-0.5">96 分 (质检通过)</p>
                </div>
                <div>
                  <span className="text-slate-400">协同处置指令：</span>
                  <p className="text-blue-200 mt-0.5">顺德交警大良中队 1 小时联合拖移</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 5: 02【透势功能】
// -------------------------------------------------------------
function Slide5() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div>
        <span className="text-xs font-mono px-2.5 py-1 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-full font-bold">
          功能 02 · 态势感知
        </span>
        <h2 className="text-3xl font-extrabold text-white mt-2">
          【透势功能】标注识别激化趋势，实现未诉先办
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400 font-bold">
            <TrendingUp className="w-5 h-5" /> 环比爆发激化率
          </div>
          <div className="text-4xl font-extrabold text-white font-mono">+186%</div>
          <p className="text-xs text-slate-400 leading-relaxed">
            实时比对历史基线，识别短时间内在特定小区/路段集中爆发的群诉，提前亮黄/红预警。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-blue-400 font-bold">
            <Building2 className="w-5 h-5" /> 顺德 10 镇街空间热力
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-300">大良街道</span>
              <span className="text-cyan-400 font-mono">428 件 (高位)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="w-[85%] h-full bg-blue-500 rounded-full" />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">容桂街道</span>
              <span className="text-cyan-400 font-mono">312 件 (激化)</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="w-[65%] h-full bg-cyan-500 rounded-full" />
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <AlertTriangle className="w-5 h-5" /> 紧急×重要四象限
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            自动将热点划入<b>【紧急高危、长效重点、日常关注、常规处理】</b>四象限，精准分配基层治理资源。
          </p>
          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
            优先处置象限 I（燃气安全、供水爆管）
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 6: 03【哨兵功能】假闭环狙击
// -------------------------------------------------------------
function Slide6({
  sentinelTriggered,
  setSentinelTriggered,
}: {
  sentinelTriggered: boolean;
  setSentinelTriggered: (v: boolean) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-mono px-2.5 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded-full font-bold">
            功能 03 · 监管利器
          </span>
          <h2 className="text-3xl font-extrabold text-white mt-2">
            【哨兵功能】72 小时“假闭环”智能狙击
          </h2>
        </div>

        <button
          onClick={() => setSentinelTriggered(!sentinelTriggered)}
          className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg flex items-center gap-2 ${
            sentinelTriggered
              ? "bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
              : "bg-gradient-to-r from-red-600 to-amber-600 text-white shadow-red-500/30 hover:brightness-110 animate-pulse"
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          {sentinelTriggered ? "重置演示" : "👉 模拟触发：48h办结后再次投诉"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <h4 className="font-bold text-slate-200 text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400" /> 真实案例时序还原
          </h4>
          <div className="space-y-2.5 text-xs">
            <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700">
              <span className="text-slate-400 font-mono">周一 10:00：</span>
              <p className="text-slate-200 mt-0.5">大良德胜新村 12 栋水管爆裂全栋停水。</p>
              <span className="text-emerald-400 font-bold text-[10px]">状态：已办结（回复已抢修）</span>
            </div>
            <div className={`p-3 rounded-lg border transition-all ${
              sentinelTriggered ? "bg-red-950/60 border-red-500 shadow-md shadow-red-500/20" : "bg-slate-800/40 border-slate-800"
            }`}>
              <span className="text-slate-400 font-mono">周二 16:00（30小时后）：</span>
              <p className="text-slate-200 mt-0.5">“还是滴水不出！根本没人来修，虚假办结！”</p>
              {sentinelTriggered && (
                <span className="text-red-400 font-bold text-[10px] animate-pulse">
                  🚨 命中哨兵模型：同一空间门牌 + 办结短时间内复发！
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <h4 className="font-bold text-slate-200 text-sm mb-2 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-red-400" /> 哨兵系统处置动作
            </h4>
            <ul className="text-xs text-slate-300 space-y-2.5">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-red-400 shrink-0" />
                自动打标红色 <b>FAKE_CLOSURE（假闭环）</b> 预警标签
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-red-400 shrink-0" />
                跳过普通派单，直生成《12345 重点督查督办函》
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-red-400 shrink-0" />
                抄送区政务服务数据管理局督查科，推动真办实结
              </li>
            </ul>
          </div>
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-semibold text-center mt-4">
            彻底杜绝“数字办结、问题依旧”的治理真空
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 7: 04【记忆功能】公文级处置建议
// -------------------------------------------------------------
function Slide7() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div>
        <span className="text-xs font-mono px-2.5 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full font-bold">
          功能 04 · 知识沉淀
        </span>
        <h2 className="text-3xl font-extrabold text-white mt-2">
          【记忆功能】公文级针对性协同处置建议
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="text-xs font-bold text-red-400 uppercase tracking-wider">传统模式（痛点）</div>
          <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-slate-400 italic">
            “请相关部门现场核实并处理。” —— 千篇一律的套话，无部门权责，无办理时限。
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-purple-500/30 space-y-3 shadow-xl">
          <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider">民声智理（公文级标准输出）</div>
          <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 text-xs text-slate-200 space-y-2 font-mono">
            <div className="text-purple-300 font-bold">【协同处置指令函】</div>
            <p>• <b>牵头科室</b>：顺德区容桂街道综合行政执法办</p>
            <p>• <b>协办科室</b>：容桂市场监督管理所</p>
            <p>• <b>响应时限</b>：限定 <b>1 小时内</b> 到场完成油烟排查</p>
            <p>• <b>法定依据</b>：《佛山市大气污染防治条例》第24条</p>
          </div>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 flex items-center justify-between">
        <span>🤖 <b>AI 研判副驾驶 (Copilot)</b>：在后台随时支持针对任意多频热点的自然语言问数与建议生成。</span>
        <span className="text-purple-400 font-mono text-[11px]">基层拿来就能直接办</span>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 8: 准确性保障与防幻觉
// -------------------------------------------------------------
function Slide8({
  aliasInput,
  setAliasInput,
}: {
  aliasInput: string;
  setAliasInput: (v: string) => void;
}) {
  const getNormalized = (text: string) => {
    if (text.includes("容奇") || text.includes("桂洲")) return "容桂街道 (法定辖区)";
    if (text.includes("德胜") || text.includes("大良")) return "大良街道 (法定辖区)";
    if (text.includes("碧桂园")) return "北滘镇 (法定辖区)";
    return "已规范化锚定顺德法定区划";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl md:text-4xl font-extrabold text-white">
          如何保证 AI 数据的准确性？ <span className="text-cyan-400">彻底根治大模型幻觉</span>
        </h2>
        <p className="text-slate-400">五大研判维度 + 法定白名单强约束 + 别名自学习进化</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <h4 className="font-bold text-slate-200 text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-400" /> 五大研判依据维度
          </h4>
          <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-blue-300 font-medium">1. 关键词要素</div>
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-cyan-300 font-medium">2. 地理拓扑</div>
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-emerald-300 font-medium">3. 时序跨度</div>
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-amber-300 font-medium">4. 群众情绪</div>
            <div className="p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-purple-300 font-medium">5. 重复频次</div>
            <div className="p-2.5 bg-blue-900/40 rounded-lg border border-blue-500/40 text-cyan-200 font-bold">综合研判</div>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 space-y-3">
          <h4 className="font-bold text-cyan-300 text-sm flex items-center gap-2">
            <Sparkle className="w-4 h-4 text-cyan-400" /> 口语别名自学习沉淀演示
          </h4>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 shrink-0">市民口语俗称：</span>
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-slate-100 font-medium text-xs focus:outline-none focus:border-cyan-500"
                placeholder="尝试输入：容奇大桥 / 德胜新区 / 碧桂园总部"
              />
            </div>
            <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-between">
              <span className="text-slate-400">入模前安全替换为：</span>
              <span className="font-bold text-emerald-400">{getNormalized(aliasInput)}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              * 10 大法定镇街白名单锁死 Prompt，AI 绝不凭空编造不存在的行政区划！
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 9: 质检器与 AI 风险定级
// -------------------------------------------------------------
function Slide9() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div>
        <span className="text-xs font-mono px-2.5 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full font-bold">
          技术保障 · 质量底线
        </span>
        <h2 className="text-3xl font-extrabold text-white mt-2">
          聚类质检器 (Validator) 与 <span className="text-amber-400">红黄蓝风险定级</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-red-950/40 border border-red-500/40 space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-bold">
            <Flame className="w-5 h-5" /> 🔴 红色高危 (HIGH)
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            涉及<b>消防通道占用、燃气泄漏隐患、群体性激化矛盾</b>等底线安全事件，立即顶格预警。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-amber-950/40 border border-amber-500/40 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <AlertTriangle className="w-5 h-5" /> 🟡 黄色中危 (MEDIUM)
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            涉及<b>夜间餐饮严重油烟、反复噪音扰民、物业乱收费</b>等爆发型民生诉求。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-blue-950/40 border border-blue-500/40 space-y-2">
          <div className="flex items-center gap-2 text-blue-400 font-bold">
            <CheckCircle2 className="w-5 h-5" /> 🔵 蓝色常规 (LOW)
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            日常市容市貌、绿化修剪、井盖报修等常规流转事项，按标准时限跟进。
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
        <span>
          <b>交叉质检器硬核规则</b>：车牌号 100% 字符精准隔离、严禁泛词（“车主/商家”）独立成群、拦截跨 3 个镇街的误拉郎配！
        </span>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 10: 极低成本与数据安全
// -------------------------------------------------------------
function Slide10() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl md:text-4xl font-extrabold text-white">
          极低推理成本与 <span className="text-emerald-400">政务数据 100% 不出域</span>
        </h2>
        <p className="text-slate-400">分层漏斗架构节省 75% 算力，全栈支持信创政务内网私有化</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <h4 className="font-bold text-white text-base flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-400" /> 分层大小模型端云协同 (降本 75%)
          </h4>
          <ul className="text-xs text-slate-300 space-y-2.5 pt-1">
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>第一层 (0 算力消耗)</b>：规则引擎与别名正则前置过滤 40% 确定性工单
            </li>
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>第二层 (轻量量化模型)</b>：本地 7B/14B 完成四要素标准抽取
            </li>
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>第三层 (按需仲裁)</b>：仅对置信度 &lt; 60 的疑难单（&lt;8%）触发专家仲裁
            </li>
          </ul>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/90 border border-emerald-500/30 space-y-3 shadow-xl">
          <h4 className="font-bold text-emerald-300 text-base flex items-center gap-2">
            <Server className="w-5 h-5 text-emerald-400" /> 数据不出域与脱敏合规
          </h4>
          <ul className="text-xs text-slate-300 space-y-2.5 pt-1">
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>全流程 PII 隐私脱敏</b>：姓名、电话、身份证号入模前自动掩码（张*、138****0000）
            </li>
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>纯离线私有化部署</b>：支持 Docker 一键拉起，兼容本地 Ollama / vLLM 离线推理
            </li>
            <li className="p-2.5 rounded-lg bg-slate-800/80">
              <b>100% 宽松开源协议</b>：无 GPL 传染风险，完全符合《网络安全法》与等保要求
            </li>
          </ul>
        </div>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 11: 商业化与千行百业迁移
// -------------------------------------------------------------
function Slide11() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      className="w-full max-w-5xl space-y-6"
    >
      <div>
        <span className="text-xs font-mono px-2.5 py-1 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-full font-bold">
          商业价值 · 场景泛化
        </span>
        <h2 className="text-3xl font-extrabold text-white mt-2">
          商业场景迁移：从政务热线到 <span className="text-cyan-400">千行百业</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
            <Building2 className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">政务 12345 / 城管 12319</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            秒级聚类海量民生诉求，识别高频违建、噪音油烟与假闭环督办。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
            <Briefcase className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">电商与企业售后客服</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            聚合多频退换货投诉、缺陷批次预警与商家违规识别，提前化解公关危机。
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
            <Headphones className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">AI 情感接线员扩展</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            实时情绪安抚与针对性答复，从电话接通第一秒根治重复投诉源头。
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-indigo-200 flex items-center justify-between">
        <span>成熟商业模型：<b>私有化交付实施费 + 年度维保与知识库自进化 SaaS 订阅</b></span>
        <span className="text-cyan-300 font-mono text-[11px]">3 天极速冷启动平移至任意区县</span>
      </div>
    </motion.div>
  );
}

// -------------------------------------------------------------
// Slide 12: 团队介绍与金句致谢
// -------------------------------------------------------------
function Slide12() {
  const members = [
    { role: "全栈工程师", name: "梁永焯", desc: "LangGraph 工作流 / 全栈系统架构" },
    { role: "UI 设计师", name: "全通", desc: "Civic Light 设计体系 / 交互动效" },
    { role: "内容运营", name: "陆艺仪", desc: "政务标准词库 / 别名知识库沉淀" },
    { role: "产品策划 / 路演", name: "梁敏诗", desc: "业务场景痛点 / 解决方案规划" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      className="w-full max-w-5xl text-center space-y-6 flex flex-col items-center justify-center"
    >
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="text-4xl md:text-5xl font-black tracking-tight"
      >
        从 <span className="text-blue-400">12345</span>，到 <span className="text-cyan-400">54321</span>。
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-cyan-300"
      >
        把问题做减法，把民心做加法。
      </motion.p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full pt-4">
        {members.map((m, i) => (
          <motion.div
            key={i}
            initial={{ y: 15, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 + i * 0.1 }}
            className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow text-center space-y-1"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-500 text-white font-bold flex items-center justify-center mx-auto mb-2 text-sm shadow-md">
              {m.name.slice(0, 1)}
            </div>
            <div className="font-bold text-white text-sm">{m.name}</div>
            <div className="text-[11px] text-cyan-400 font-medium">{m.role}</div>
            <div className="text-[10px] text-slate-400 pt-0.5">{m.desc}</div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="pt-4 text-slate-400 text-sm flex items-center gap-2"
      >
        <span>赢了就回家吃鱼生 团队</span>
        <span>•</span>
        <span className="text-cyan-400">谢谢各位评委老师！欢迎提问指正！</span>
      </motion.div>
    </motion.div>
  );
}
