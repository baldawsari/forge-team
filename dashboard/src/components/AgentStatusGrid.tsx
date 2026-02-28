"use client";

import React, { useState } from "react";
import { Cpu, Brain, UserCheck, UserX } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/mock-data";
import type { Escalation } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface AgentStatusGridProps {
  agents: Agent[];
  escalations?: Escalation[];
  takenOverAgents?: string[];
  onTakeOver?: (agentId: string) => void;
  onRelease?: (agentId: string) => void;
}

const statusLabels: Record<string, { en: string; ar: string }> = {
  idle: { en: "Idle", ar: "خامل" },
  working: { en: "Working", ar: "يعمل" },
  reviewing: { en: "Reviewing", ar: "يراجع" },
  blocked: { en: "Blocked", ar: "متوقف" },
  human_controlled: { en: "Human Controlled", ar: "تحكم بشري" },
};

function AgentDetailModal({
  agent,
  locale,
  open,
  onOpenChange,
  isTakenOver,
  onTakeOver,
  onRelease,
}: {
  agent: Agent;
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isTakenOver?: boolean;
  onTakeOver?: (agentId: string) => void;
  onRelease?: (agentId: string) => void;
}) {
  const isAr = locale === "ar";
  const { t } = useLocale();

  const formattedTokens = (agent.tokensUsed / 1000).toFixed(0);
  const longTermEntries = Math.round(agent.tokensUsed / 5200);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">
            {isAr ? agent.nameAr : agent.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4">
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
              <Badge variant="outline" className="text-xs text-text-muted border-transparent px-0">
                {isAr ? statusLabels[agent.status].ar : statusLabels[agent.status].en}
              </Badge>
            </div>
          </div>
        </div>

        {/* Model info */}
        <div className="space-y-3">
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
        <div className="border-t border-border/40 pt-4">
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
        <div className="border-t border-border/40 pt-4">
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

        {/* Take Over button */}
        <div className="border-t border-border/40 pt-4 mt-4">
          {isTakenOver ? (
            <button
              onClick={() => onRelease?.(agent.id)}
              className="w-full py-2.5 rounded-lg bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors flex items-center justify-center gap-2"
            >
              <UserX size={14} />
              {t("takeover.release")}
            </button>
          ) : (
            <button
              onClick={() => onTakeOver?.(agent.id)}
              className="w-full py-2.5 rounded-lg bg-primary/20 text-primary-light text-sm font-medium hover:bg-primary/30 transition-colors flex items-center justify-center gap-2"
            >
              <UserCheck size={14} />
              {t("takeover.takeOver")}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentStatusGrid({ agents, escalations, takenOverAgents, onTakeOver, onRelease }: AgentStatusGridProps) {
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
          {agents.map((agent) => {
            const hasEscalation = escalations?.some(e => e.agentId === agent.id && e.status === 'pending');
            const isTakenOver = takenOverAgents?.includes(agent.id) ?? false;
            const effectiveStatus = isTakenOver ? 'human_controlled' : agent.status;
            const statusLabel = statusLabels[effectiveStatus] ?? statusLabels[agent.status];
            return (
              <button
                key={agent.id}
                onClick={() => setSelectedAgent(agent.id)}
                className={cn(
                  "p-2.5 rounded-lg text-start transition-all",
                  "bg-surface-light/30 hover:bg-surface-light/60",
                  "border border-transparent hover:border-primary/30",
                  agent.status === "working" && "ring-1 ring-status-working/30",
                  isTakenOver && "ring-1 ring-amber-500/50"
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
                      <span className={cn("status-dot", effectiveStatus)} style={{ width: 7, height: 7 }} />
                      <Badge variant="outline" className="text-[10px] text-text-muted border-transparent px-0 py-0 h-auto">
                        {isAr ? statusLabel?.ar : statusLabel?.en}
                      </Badge>
                      {hasEscalation && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 ms-auto">
                          {t("escalation.badge")}
                        </span>
                      )}
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
            );
          })}
        </div>
      </div>

      {selectedAgentData && (
        <AgentDetailModal
          agent={selectedAgentData}
          locale={locale}
          open={!!selectedAgent}
          onOpenChange={(open) => { if (!open) setSelectedAgent(null); }}
          isTakenOver={takenOverAgents?.includes(selectedAgentData.id) ?? false}
          onTakeOver={onTakeOver}
          onRelease={onRelease}
        />
      )}
    </>
  );
}
