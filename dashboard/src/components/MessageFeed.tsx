"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import type { Message, Agent } from "@/lib/mock-data";

interface MessageFeedProps {
  messages: Message[];
  agents?: Agent[];
}

const typeColors: Record<string, string> = {
  task: "#3b82f6",
  question: "#f59e0b",
  escalation: "#dc3545",
};

const typeLabels: Record<string, { en: string; ar: string }> = {
  task: { en: "Task", ar: "مهمة" },
  question: { en: "Question", ar: "سؤال" },
  escalation: { en: "Escalation", ar: "تصعيد" },
};

export default function MessageFeed({ messages, agents }: MessageFeedProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const filteredMessages = messages.filter((msg) => {
    const matchesSearch =
      search === "" ||
      msg.content.toLowerCase().includes(search.toLowerCase()) ||
      msg.from.toLowerCase().includes(search.toLowerCase()) ||
      (msg.contentAr && msg.contentAr.includes(search));

    const matchesType = typeFilter === "all" || msg.type === typeFilter;

    const matchesAgent =
      agentFilter === "all" || msg.from === agentFilter || msg.to === agentFilter;

    return matchesSearch && matchesType && matchesAgent;
  });

  function formatTimestamp(ts: string): string {
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, "0");
    const mins = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${mins}`;
  }

  return (
    <div className="glass-card p-4 flex flex-col h-full">
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        {t("messages.title")}
      </h2>

      {/* Search + Agent Filter */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute top-1/2 -translate-y-1/2 text-text-muted"
            style={{ insetInlineStart: "10px" }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("messages.search")}
            className={cn(
              "w-full bg-surface-light/50 text-text-primary text-xs rounded-lg py-2 border border-border/30",
              "focus:outline-none focus:border-primary/50 placeholder:text-text-muted/50"
            )}
            style={{ paddingInlineStart: "32px", paddingInlineEnd: "10px" }}
          />
        </div>
        {agents && agents.length > 0 && (
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-surface-light/50 text-text-primary text-xs rounded-lg px-2 py-2 border border-border/30 focus:outline-none focus:border-primary/50 shrink-0"
          >
            <option value="all">{t("messages.allAgents")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {isAr ? agent.nameAr : agent.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Type filter pills */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {["all", "task", "question", "escalation"].map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={cn(
              "text-[10px] px-2.5 py-1 rounded-full transition-colors font-medium",
              typeFilter === type
                ? "bg-primary/30 text-primary-light border border-primary/40"
                : "bg-surface-light/30 text-text-muted border border-transparent hover:bg-surface-light/50"
            )}
          >
            {type === "all"
              ? t("messages.filterAll")
              : isAr
                ? typeLabels[type].ar
                : typeLabels[type].en}
          </button>
        ))}
      </div>

      {/* Messages feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto space-y-2 min-h-0"
        style={{ maxHeight: "300px" }}
      >
        {filteredMessages.length === 0 ? (
          <div className="text-center text-text-muted/40 text-xs py-8">
            {t("messages.noMessages")}
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "p-3 rounded-lg transition-colors",
                msg.isHuman
                  ? "message-human"
                  : "bg-surface-light/20 hover:bg-surface-light/40"
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className="text-lg shrink-0 mt-0.5">{msg.fromAvatar}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-text-primary">
                      {msg.from}
                    </span>
                    {msg.to && (
                      <>
                        <span className="text-text-muted/40 text-[10px]">
                          {isAr ? "\u2190" : "\u2192"}
                        </span>
                        <span className="text-xs text-text-secondary">
                          {msg.to}
                        </span>
                      </>
                    )}
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: `${typeColors[msg.type] ?? '#6b7280'}20`,
                        color: typeColors[msg.type] ?? '#6b7280',
                      }}
                    >
                      {isAr ? (typeLabels[msg.type]?.ar ?? msg.type) : (typeLabels[msg.type]?.en ?? msg.type)}
                    </span>
                    <span className="text-[10px] text-text-muted/50 ltr-nums ms-auto">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed bidi-auto" dir="auto">
                    {isAr && msg.contentAr ? msg.contentAr : msg.content}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
