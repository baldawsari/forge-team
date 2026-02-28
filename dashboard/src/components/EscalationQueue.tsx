"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { fetchEscalations, reviewEscalation, dismissEscalation, type Escalation } from "@/lib/api";
import type { Agent } from "@/lib/mock-data";

interface EscalationQueueProps {
  agents: Agent[];
}

type FilterTab = "all" | "pending" | "reviewed" | "dismissed";

export default function EscalationQueue({ agents }: EscalationQueueProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const { on } = useSocket();

  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const agentMap = React.useMemo(() => {
    const m: Record<string, Agent> = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  const loadEscalations = useCallback(async () => {
    try {
      const res = await fetchEscalations();
      setEscalations(res.escalations);
    } catch {
      // gateway offline
    }
  }, []);

  useEffect(() => {
    loadEscalations();
  }, [loadEscalations]);

  useEffect(() => {
    const unsub = on("escalation_update" as any, (data: any) => {
      if (data.type === "created" && data.escalation) {
        setEscalations((prev) => [...prev, data.escalation]);
      } else {
        loadEscalations();
      }
    });
    return unsub;
  }, [on, loadEscalations]);

  const filtered =
    activeTab === "all"
      ? escalations
      : escalations.filter((e) => e.status === activeTab);

  const pendingCount = escalations.filter((e) => e.status === "pending").length;

  const handleReview = async (id: string) => {
    try {
      await reviewEscalation(id, feedback || undefined);
      setEscalations((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: "reviewed" as const } : e))
      );
      setReviewingId(null);
      setFeedback("");
    } catch {
      // ignore
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await dismissEscalation(id);
      setEscalations((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: "dismissed" as const } : e))
      );
    } catch {
      // ignore
    }
  };

  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: isAr ? "الكل" : "All" },
    { id: "pending", label: t("escalation.pending") },
    { id: "reviewed", label: t("escalation.reviewed") },
    { id: "dismissed", label: t("escalation.dismissed") },
  ];

  function confidenceColor(c: number): string {
    if (c < 0.7) return "bg-red-500";
    if (c < 0.85) return "bg-amber-500";
    return "bg-green-500";
  }

  function confidenceTextColor(c: number): string {
    if (c < 0.7) return "text-red-400";
    if (c < 0.85) return "text-amber-400";
    return "text-green-400";
  }

  return (
    <div className="glass-card p-4 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          {t("escalation.title")}
          {pendingCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold ltr-nums">
              {pendingCount}
            </span>
          )}
        </h2>
        <span className="text-[10px] text-text-muted">
          {t("escalation.threshold")}
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "text-[11px] px-3 py-1.5 rounded-lg transition-colors font-medium",
              activeTab === tab.id
                ? "bg-primary/20 text-primary-light border border-primary/30"
                : "text-text-muted hover:bg-surface-light/30 border border-transparent"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Escalation list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">
            {t("escalation.noEscalations")}
          </p>
        ) : (
          filtered.map((esc) => {
            const agent = agentMap[esc.agentId];
            const isExpanded = expandedId === esc.id;

            return (
              <div
                key={esc.id}
                className="p-3 rounded-lg bg-surface-light/30 border border-border/30 space-y-2"
              >
                {/* Agent info */}
                <div className="flex items-center gap-2">
                  <span className="text-lg">{agent?.avatar ?? "🤖"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">
                      {agent
                        ? isAr
                          ? agent.nameAr
                          : agent.name
                        : esc.agentName}
                    </p>
                    <p className="text-[10px] text-text-muted truncate">
                      {esc.taskTitle}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full font-medium",
                      esc.status === "pending" && "bg-amber-500/15 text-amber-400",
                      esc.status === "reviewed" && "bg-green-500/15 text-green-400",
                      esc.status === "dismissed" && "bg-text-muted/15 text-text-muted"
                    )}
                  >
                    {t(`escalation.${esc.status}`)}
                  </span>
                </div>

                {/* Confidence bar */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">
                    {t("escalation.confidence")}
                  </span>
                  <div className="flex-1 h-1.5 bg-surface-light/50 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", confidenceColor(esc.confidence))}
                      style={{ width: `${Math.round(esc.confidence * 100)}%` }}
                    />
                  </div>
                  <span className={cn("text-[10px] font-bold ltr-nums", confidenceTextColor(esc.confidence))}>
                    {Math.round(esc.confidence * 100)}%
                  </span>
                </div>

                {/* Reason */}
                <div>
                  <span className="text-[10px] text-text-muted">{t("escalation.reason")}:</span>
                  <p className="text-xs text-text-secondary" dir="auto">
                    {esc.reason}
                  </p>
                </div>

                {/* Expandable response */}
                {esc.agentResponse && (
                  <div>
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : esc.id)
                      }
                      className="flex items-center gap-1 text-[10px] text-primary-light hover:text-primary transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      {isExpanded
                        ? isAr
                          ? "إخفاء الاستجابة"
                          : "Hide response"
                        : isAr
                          ? "عرض الاستجابة"
                          : "Show response"}
                    </button>
                    {isExpanded && (
                      <p className="text-[11px] text-text-muted mt-1 p-2 rounded bg-surface-light/20 leading-relaxed" dir="auto">
                        {esc.agentResponse}
                      </p>
                    )}
                  </div>
                )}

                {/* Timestamp */}
                <div className="flex items-center gap-1 text-[10px] text-text-muted/60">
                  <Clock size={10} />
                  <span className="ltr-nums">
                    {new Date(esc.createdAt).toLocaleTimeString()}
                  </span>
                </div>

                {/* Actions */}
                {esc.status === "pending" && (
                  <div className="flex items-center gap-2 pt-1">
                    {reviewingId === esc.id ? (
                      <div className="flex-1 flex gap-1">
                        <input
                          dir="auto"
                          type="text"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleReview(esc.id);
                          }}
                          placeholder={t("escalation.feedbackPlaceholder")}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-surface-light/30 border border-primary/30 text-text-primary text-[11px] focus:outline-none focus:border-primary/60"
                        />
                        <button
                          onClick={() => handleReview(esc.id)}
                          className="px-2 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] hover:bg-green-500/25 transition-colors"
                        >
                          <CheckCircle2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReviewingId(esc.id)}
                        className="flex-1 py-1.5 rounded-lg bg-primary/15 text-primary-light text-[11px] font-medium hover:bg-primary/25 transition-colors flex items-center justify-center gap-1"
                      >
                        <CheckCircle2 size={12} />
                        {t("escalation.review")}
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(esc.id)}
                      className="flex-1 py-1.5 rounded-lg bg-text-muted/10 text-text-muted text-[11px] font-medium hover:bg-text-muted/20 transition-colors flex items-center justify-center gap-1"
                    >
                      <XCircle size={12} />
                      {t("escalation.dismiss")}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
