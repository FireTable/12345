"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Play, Film, ExternalLink } from "lucide-react";

export interface DemoVideo {
  id: string;
  title: string;
  desc: string;
  src: string;
  tag: string;
}

export const DEMO_VIDEOS: DemoVideo[] = [
  {
    id: "overview",
    title: "系统全景总览",
    desc: "民声智理整体架构、核心价值、AI 研判闭环与基层赋能成效",
    src: "/videos/民声智理_总览片_v1.mp4",
    tag: "🌟 全景宣传片",
  },
  {
    id: "dashboard",
    title: "数据总览看板",
    desc: "10 镇街热点地图、全区实时工单统计、多维处置率指标与 AI Copilot 交互",
    src: "/videos/数据总览.mp4",
    tag: "📊 首页态势",
  },
  {
    id: "themes",
    title: "多频工单看板",
    desc: "183+ 多频主题群组智能聚类、一键折叠详情、实体拓扑与公文级处置建议",
    src: "/videos/多频工单.mp4",
    tag: "🗂️ 双轨聚类",
  },
  {
    id: "multifreq",
    title: "工单透势研判",
    desc: "四象限与假闭环追踪：紧急×重要象限图、72h 时序衰减追踪与重点督办单",
    src: "/videos/工单透势.mp4",
    tag: "📈 假闭环狙击",
  },
  {
    id: "tickets",
    title: "工单中心核查",
    desc: "全量工单穿透、高阶复合检索、四要素抽取明细与二级 AI 仲裁消歧记录",
    src: "/videos/工单中心.mp4",
    tag: "📑 四要素抽取",
  },
  {
    id: "dict",
    title: "标准字典治理",
    desc: "顺德 10 大镇街/98+村居白名单、别名自学习沉淀与权威实体对齐管理",
    src: "/videos/标准字典.mp4",
    tag: "📖 权威白名单",
  },
];

export function VideoModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [activeVideo, setActiveVideo] = useState<DemoVideo>(DEMO_VIDEOS[0]);
  const [isBuffering, setIsBuffering] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Handle switching video without destroying video DOM element
  const handleSelectVideo = (vid: DemoVideo) => {
    if (vid.id === activeVideo.id) return;
    setIsBuffering(true);
    setActiveVideo(vid);
    if (videoRef.current) {
      videoRef.current.src = vid.src;
      videoRef.current.load();
      videoRef.current.play().catch(() => {
        // Autoplay may be blocked by browser policy without user gesture
      });
    }
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="video-modal-backdrop" onClick={onClose}>
      <div
        className="video-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-modal-title"
      >
        {/* Modal Header */}
        <div className="video-modal-header">
          <div className="video-modal-header-left">
            <div className="video-modal-icon-badge">
              <Film size={18} />
            </div>
            <div>
              <div id="video-modal-title" className="video-modal-title">
                系统功能演示视频
              </div>
              <div className="video-modal-subtitle">
                民声智理 · 顺德 12345 AI 智能研判系统演示全集
              </div>
            </div>
          </div>
          <button
            type="button"
            className="video-modal-close-btn"
            onClick={onClose}
            aria-label="关闭视频"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body: Player + Playlist */}
        <div className="video-modal-body">
          {/* Main Video Area */}
          <div className="video-player-container">
            <div className="video-screen-wrap">
              <video
                ref={videoRef}
                src={activeVideo.src}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="video-element"
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => setIsBuffering(false)}
                onCanPlay={() => setIsBuffering(false)}
                onLoadedData={() => setIsBuffering(false)}
              >
                您的浏览器不支持 HTML5 视频播放。
              </video>
              {isBuffering && (
                <div className="video-buffering-indicator">
                  <div className="login-spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                </div>
              )}
            </div>
            <div className="video-info-card">
              <div className="video-info-top">
                <span className="video-tag-pill">{activeVideo.tag}</span>
                <span className="video-info-title">{activeVideo.title}</span>
                <a
                  href={activeVideo.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="video-open-raw-link"
                  title="在新窗口直接打开"
                >
                  <ExternalLink size={13} />
                  <span>独立窗口播放</span>
                </a>
              </div>
              <div className="video-info-desc">{activeVideo.desc}</div>
            </div>
          </div>

          {/* Playlist Sidebar */}
          <div className="video-playlist-sidebar">
            <div className="video-playlist-title">
              <span>演示视频列表</span>
              <span className="video-playlist-count">{DEMO_VIDEOS.length} 个视频</span>
            </div>
            <div className="video-playlist-items">
              {DEMO_VIDEOS.map((vid, idx) => {
                const isActive = vid.id === activeVideo.id;
                return (
                  <button
                    key={vid.id}
                    type="button"
                    className={`video-playlist-item${isActive ? " is-active" : ""}`}
                    onClick={() => handleSelectVideo(vid)}
                  >
                    <div className="video-item-index">
                      {isActive ? <Play size={12} fill="currentColor" /> : idx + 1}
                    </div>
                    <div className="video-item-meta">
                      <div className="video-item-title-row">
                        <span className="video-item-title">{vid.title}</span>
                        {isActive && <span className="video-playing-tag">播放中</span>}
                      </div>
                      <span className="video-item-tag">{vid.tag}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
