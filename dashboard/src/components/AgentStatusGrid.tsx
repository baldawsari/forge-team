"use client";

import React, { useState } from "react";
import { X, Cpu, Brain } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/mock-data";

interface AgentStatusGridProps {
  agents: Agent[];
}

const statusLabels: Record<string, { en: string; ar: string }> = {
  idle: { en: "Idle", ar: "خامل" },
  working: { en: "Working", ar: "يعمل" },
  reviewing: { en: "Reviewing", ar: "يراجع" },
  blocked: { en: "Blocked", ar: "متوقف" },
};

function AgentDetailModal({
  agent,
  locale,
  onClose,
}: {
  agent: Agent;
  locale: string;
  onClose: () => void;
}) {
  const isAr = locale === "ar";
  const { t } = useLocale();

  const formattedTokens = (agent.tokensUsed / 1000).toFixed(0);
  const longTermEntries = Math.round(agent.tokensUsed / 5200);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 end-4 text-text-secondary hover:text-text-primary transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="text-4xl">{agent.avatar}</div>
          <div>
            <h3 className="text-lg font-bold text-text-primary">
              {isAr ? agent.nameAr : agent.name}
            </h3>
            <p className="text-sm text-text-secondary">
              {isAr ? agent.roleAr : agent.role}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("status-dot", agent.status)} />
              <span className="text-xs text-text-muted">
                {isAr ? statusLabels[agent.status].ar : statusLabels[agent.status].en}
              </span>
            </div>
          </div>
        </div>

        {/* Model info */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-light/50">
            <Cpu size={16} className="text-primary-light shrink-0" />
            <div>
              <p className="text-xs text-text-muted">{t("agents.primaryModel")}</p>
              <p className="text-sm font-medium text-text-primary ltr-nums">{agent.model}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-light/50">
            <Cpu size={16} className="text-text-muted shrink-0" />
            <div>
              <p className="text-xs text-text-muted">{t("agents.fallbackModel")}</p>
              <p className="text-sm font-medium text-text-primary ltr-nums">{agent.fallbackModel}</p>
            </div>
          </div>
        </div>

        {/* Current task */}
        <div className="border-t border-border/40 pt-4 mb-4">
          <h4 className="text-sm font-semibold text-text-secondary mb-2">
            {t("agents.currentTask")}
          </h4>
          <p className="text-sm text-text-primary bidi-auto">
            {agent.currentTask
              ? isAr
                ? agent.currentTaskAr
                : agent.currentTask
              : t("agents.noActiveTask")}
          </p>
        </div>

        {/* Stats */}
        <div className="border-t border-border/40 pt-4 grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-xs text-text-muted">{t("agents.temperature")}</p>
            <p className="text-sm font-bold text-text-primary ltr-nums">{agent.temperature}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-muted">{t("agents.tokens")}</p>
            <p className="text-sm font-bold text-text-primary ltr-nums">
              {(agent.tokensUsed / 1000).toFixed(0)}K
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-text-muted">{t("agents.cost")}</p>
            <p className="text-sm font-bold text-text-primary ltr-nums">${agent.cost.toFixed(2)}</p>
          </div>
        </div>

        {/* Memory */}
        <div className="border-t border-border/40 pt-4 mt-4">
          <h4 className="text-sm font-semibold text-text-secondary mb-2 flex items-center gap-2">
            <Brain size={14} />
            {t("agents.memory")}
          </h4>
          <div className="text-xs text-text-muted p-3 rounded bg-surface-light/30 space-y-1">
            <p className="ltr-nums">
              {formattedTokens}K {t("agents.shortTermMemory")}
            </p>
            <p className="ltr-nums">
              {longTermEntries} {t("agents.longTermEntries")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentStatusGrid({ agents }: AgentStatusGridProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const selectedAgentData = selectedAgent
    ? agents.find((a) => a.id === selectedAgent)
    : null;

  return (
    <>
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3">
          {t("agents.title")}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              className={cn(
                "p-2.5 rounded-lg text-start transition-all",
                "bg-surface-light/30 hover:bg-surface-light/60",
                "border border-transparent hover:border-primary/30",
                agent.status === "working" && "ring-1 ring-status-working/30"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{agent.avatar}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {isAr ? agent.nameAr : agent.name}
                  </p>
                  <p className="text-[9px] text-text-muted/60 truncate">
                    {isAr ? agent.roleAr : agent.role}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("status-dot", agent.status)} style={{ width: 7, height: 7 }} />
                    <span className="text-[10px] text-text-muted">
                      {isAr ? statusLabels[agent.status].ar : statusLabels[agent.status].en}
                    </span>
                  </div>
                </div>
              </div>
              {agent.currentTask && (
                <p className="text-[10px] text-text-muted truncate ps-7 bidi-auto">
                  {isAr ? agent.currentTaskAr : agent.currentTask}
                </p>
              )}
              <p className="text-[10px] text-text-muted/60 ps-7 ltr-nums mt-0.5">
                {agent.model}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selectedAgentData && (
        <AgentDetailModal
          agent={selectedAgentData}
          locale={locale}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </>
  );
}
