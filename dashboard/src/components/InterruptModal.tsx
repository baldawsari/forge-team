"use client";

import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle2, XCircle, Clock, MessageSquare } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { fetchPendingInterrupts, resolveInterrupt, type Interrupt } from "@/lib/api";
import type { Agent } from "@/lib/mock-data";

interface InterruptModalProps {
  agents: Agent[];
}

const typeLabels: Record<string, { en: string; ar: string; icon: React.ReactNode }> = {
  approval_gate: {
    en: "Approval Gate",
    ar: "بوابة الموافقة",
    icon: <CheckCircle2 size={12} />,
  },
  human_mention: {
    en: "@human Mention",
    ar: "إشارة @إنسان",
    icon: <MessageSquare size={12} />,
  },
  confidence_low: {
    en: "Low Confidence",
    ar: "ثقة منخفضة",
    icon: <AlertTriangle size={12} />,
  },
};

export default function InterruptModal({ agents }: InterruptModalProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const { on } = useSocket();

  const [interrupts, setInterrupts] = useState<Interrupt[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const agentMap = React.useMemo(() => {
    const m: Record<string, Agent> = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  const loadInterrupts = useCallback(async () => {
    try {
      const res = await fetchPendingInterrupts();
      setInterrupts(res.interrupts);
    } catch {
      // gateway offline
    }
  }, []);

  useEffect(() => {
    loadInterrupts();
    const interval = setInterval(loadInterrupts, 5000);
    return () => clearInterval(interval);
  }, [loadInterrupts]);

  useEffect(() => {
    const unsub = on("interrupt_update" as any, (data: any) => {
      if (data.type === "created" && data.interrupt) {
        setInterrupts((prev) => [...prev, data.interrupt]);
        const agentName = data.interrupt.agentName ?? data.interrupt.agentId;
        setToast(`${t("interrupt.newInterrupt")} ${agentName}`);
        setTimeout(() => setToast(null), 5000);
      } else {
        loadInterrupts();
      }
    });
    return unsub;
  }, [on, loadInterrupts, t]);

  const pendingCount = interrupts.filter((i) => i.status === "pending").length;

  const handleApprove = async (id: string) => {
    try {
      await resolveInterrupt(id, true);
      setInterrupts((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // ignore
    }
  };

  const handleReject = async (id: string) => {
    try {
      await resolveInterrupt(id, false, feedback || undefined);
      setInterrupts((prev) => prev.filter((i) => i.id !== id));
      setRejectingId(null);
      setFeedback("");
    } catch {
      // ignore
    }
  };

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 end-4 z-[60] px-4 py-3 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* Floating badge */}
      {pendingCount > 0 && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed top-4 end-20 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors shadow-lg backdrop-blur-sm"
        >
          <AlertTriangle size={14} />
          <span className="text-xs font-bold ltr-nums">{pendingCount}</span>
          <span className="text-xs">{t("interrupt.pendingCount")}</span>
        </button>
      )}

      {/* Modal overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative z-10 glass-card border-border max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/40">
              <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                {t("interrupt.title")}
                {pendingCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold ltr-nums">
                    {pendingCount}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Interrupt list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {interrupts.filter((i) => i.status === "pending").length === 0 ? (
                <p className="text-sm text-text-muted text-center py-8">
                  {t("interrupt.noInterrupts")}
                </p>
              ) : (
                interrupts
                  .filter((i) => i.status === "pending")
                  .map((interrupt) => {
                    const agent = agentMap[interrupt.agentId];
                    const typeInfo = typeLabels[interrupt.type] ?? typeLabels.approval_gate;

                    return (
                      <div
                        key={interrupt.id}
                        className="p-3 rounded-lg bg-surface-light/30 border border-border/30 space-y-2"
                      >
                        {/* Agent info + type badge */}
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{agent?.avatar ?? "🤖"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-text-primary truncate">
                              {agent
                                ? isAr
                                  ? agent.nameAr
                                  : agent.name
                                : interrupt.agentName}
                            </p>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex items-center gap-1">
                            {typeInfo.icon}
                            {isAr ? typeInfo.ar : typeInfo.en}
                          </span>
                        </div>

                        {/* Question */}
                        <p className="text-xs text-text-primary leading-relaxed" dir="auto">
                          {interrupt.question}
                        </p>

                        {/* Context */}
                        {interrupt.context && (
                          <p className="text-[11px] text-text-muted" dir="auto">
                            {interrupt.context}
                          </p>
                        )}

                        {/* Confidence bar */}
                        {interrupt.type === "confidence_low" &&
                          interrupt.confidence != null && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-surface-light/50 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    interrupt.confidence < 0.7
                                      ? "bg-red-500"
                                      : interrupt.confidence < 0.85
                                        ? "bg-amber-500"
                                        : "bg-green-500"
                                  )}
                                  style={{
                                    width: `${Math.round(interrupt.confidence * 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-text-muted ltr-nums">
                                {Math.round(interrupt.confidence * 100)}%
                              </span>
                            </div>
                          )}

                        {/* Timestamp */}
                        <div className="flex items-center gap-1 text-[10px] text-text-muted/60">
                          <Clock size={10} />
                          <span className="ltr-nums">
                            {new Date(interrupt.createdAt).toLocaleTimeString()}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleApprove(interrupt.id)}
                            className="flex-1 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-medium hover:bg-green-500/25 transition-colors flex items-center justify-center gap-1"
                          >
                            <CheckCircle2 size={12} />
                            {t("interrupt.approve")}
                          </button>
                          {rejectingId === interrupt.id ? (
                            <div className="flex-1 flex gap-1">
                              <input
                                dir="auto"
                                type="text"
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleReject(interrupt.id);
                                }}
                                placeholder={t("interrupt.feedbackPlaceholder")}
                                className="flex-1 px-2 py-1.5 rounded-lg bg-surface-light/30 border border-red-500/30 text-text-primary text-[11px] focus:outline-none focus:border-red-500/60"
                              />
                              <button
                                onClick={() => handleReject(interrupt.id)}
                                className="px-2 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] hover:bg-red-500/25 transition-colors"
                              >
                                ✓
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRejectingId(interrupt.id)}
                              className="flex-1 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-medium hover:bg-red-500/25 transition-colors flex items-center justify-center gap-1"
                            >
                              <XCircle size={12} />
                              {t("interrupt.reject")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
