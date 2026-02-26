"use client";

import React, { useState } from "react";
import {
  Shield,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
  Filter,
} from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import type { DelegationEntry, Agent } from "@/lib/mock-data";

interface ViadpAuditLogProps {
  delegations: DelegationEntry[];
  agents: Agent[];
}

const statusConfig = {
  verified: {
    icon: CheckCircle2,
    color: "#28a745",
    enLabel: "Verified",
    arLabel: "تم التحقق",
  },
  pending: {
    icon: Clock,
    color: "#f59e0b",
    enLabel: "Pending",
    arLabel: "قيد الانتظار",
  },
  failed: {
    icon: XCircle,
    color: "#dc3545",
    enLabel: "Failed",
    arLabel: "فشل",
  },
};

function getTrustScoreColor(score: number): string {
  if (score >= 0.9) return "#28a745";
  if (score >= 0.7) return "#f59e0b";
  return "#dc3545";
}

export default function ViadpAuditLog({ delegations, agents }: ViadpAuditLogProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredDelegations = delegations.filter((d) => {
    const matchesAgent =
      agentFilter === "all" ||
      d.delegator === agentFilter ||
      d.delegatee === agentFilter;
    const matchesStatus = statusFilter === "all" || d.status === statusFilter;
    return matchesAgent && matchesStatus;
  });

  const uniqueAgentNames = [
    ...new Set(delegations.flatMap((d) => [d.delegator, d.delegatee])),
  ];

  function formatTimestamp(ts: string): string {
    const date = new Date(ts);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const hours = date.getHours().toString().padStart(2, "0");
    const mins = date.getMinutes().toString().padStart(2, "0");
    return `${month}/${day} ${hours}:${mins}`;
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Shield size={16} className="text-primary-light" />
          {t("viadp.title")}
        </h2>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-text-muted" />
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-surface-light/50 text-text-primary text-xs rounded-lg px-2 py-1.5 border border-border/30 focus:outline-none focus:border-primary/50"
          >
            <option value="all">{t("viadp.filterByAgent")}: {t("viadp.all")}</option>
            {uniqueAgentNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-light/50 text-text-primary text-xs rounded-lg px-2 py-1.5 border border-border/30 focus:outline-none focus:border-primary/50"
        >
          <option value="all">{t("viadp.filterByOutcome")}: {t("viadp.all")}</option>
          <option value="verified">{isAr ? "تم التحقق" : "Verified"}</option>
          <option value="pending">{isAr ? "قيد الانتظار" : "Pending"}</option>
          <option value="failed">{isAr ? "فشل" : "Failed"}</option>
        </select>
      </div>

      {/* Timeline */}
      <div className="space-y-3 relative">
        {/* Timeline line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-border/30"
          style={{ insetInlineStart: "16px" }}
        />

        {filteredDelegations.map((delegation) => {
          const config = statusConfig[delegation.status];
          const StatusIcon = config.icon;
          const isExpanded = expandedId === delegation.id;

          return (
            <div key={delegation.id} className="relative" style={{ paddingInlineStart: "40px" }}>
              {/* Timeline dot */}
              <div
                className="absolute top-3 w-[9px] h-[9px] rounded-full border-2 bg-surface"
                style={{
                  insetInlineStart: "12px",
                  borderColor: config.color,
                }}
              />

              <div
                className={cn(
                  "p-3 rounded-lg transition-all cursor-pointer",
                  "bg-surface-light/20 hover:bg-surface-light/40",
                  isExpanded && "bg-surface-light/40"
                )}
                onClick={() => setExpandedId(isExpanded ? null : delegation.id)}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-text-primary">
                      {delegation.delegator}
                    </span>
                    <span className="text-text-muted/40 text-[10px]">
                      {isAr ? "←" : "→"}
                    </span>
                    <span className="text-xs font-semibold text-text-primary">
                      {delegation.delegatee}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium"
                      style={{
                        backgroundColor: `${config.color}20`,
                        color: config.color,
                      }}
                    >
                      <StatusIcon size={10} />
                      {isAr ? config.arLabel : config.enLabel}
                    </span>
                    {isExpanded ? (
                      <ChevronUp size={14} className="text-text-muted" />
                    ) : (
                      <ChevronDown size={14} className="text-text-muted" />
                    )}
                  </div>
                </div>

                {/* Task */}
                <p className="text-xs text-text-secondary mb-2 bidi-auto">
                  {isAr ? delegation.taskAr : delegation.task}
                </p>

                {/* Meta */}
                <div className="flex items-center gap-4 text-[10px] text-text-muted">
                  <span className="ltr-nums">{formatTimestamp(delegation.timestamp)}</span>
                  <span className="flex items-center gap-1">
                    {isAr ? "درجة الثقة:" : "Trust:"}
                    <span
                      className="font-semibold ltr-nums"
                      style={{ color: getTrustScoreColor(delegation.trustScore) }}
                    >
                      {(delegation.trustScore * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>

                {/* Expanded proof chain */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/20">
                    <h4 className="text-[10px] font-semibold text-text-secondary mb-2">
                      {t("viadp.proofChain")}
                    </h4>
                    <div className="space-y-1.5">
                      {delegation.proofChain.map((step, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-[10px] text-text-muted"
                        >
                          <span className="text-primary-light font-mono ltr-nums shrink-0">
                            {i + 1}.
                          </span>
                          <span dir="auto" className="bidi-auto">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
