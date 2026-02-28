"use client";

import React, { useMemo } from "react";
import { CheckCircle2, Circle, PlayCircle, Pause, Play } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import type { WorkflowPhase } from "@/lib/mock-data";

interface WorkflowProgressProps {
  phases: WorkflowPhase[];
  onPauseAll?: () => void;
  onResumeAll?: () => void;
}

function getPhaseIcon(status: string) {
  switch (status) {
    case "complete":
      return <CheckCircle2 size={18} className="text-success" />;
    case "active":
      return <PlayCircle size={18} className="text-accent" />;
    default:
      return <Circle size={18} className="text-text-muted/40" />;
  }
}

function getStatusLabel(status: string, isAr: boolean): string {
  switch (status) {
    case "complete":
      return isAr ? "مكتمل" : "Complete";
    case "active":
      return isAr ? "نشط" : "Active";
    default:
      return isAr ? "قيد الانتظار" : "Pending";
  }
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (86400000));
}

export default function WorkflowProgress({ phases, onPauseAll, onResumeAll }: WorkflowProgressProps) {
  const { locale, t, direction } = useLocale();
  const isAr = locale === "ar";

  const totalProgress = Math.round(
    phases.reduce((sum, p) => sum + p.progress, 0) / phases.length
  );

  const { rangeStart, totalDays, timelineLabels } = useMemo(() => {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const phase of phases) {
      const start = parseDate(phase.startDate).getTime();
      if (start < earliest) earliest = start;
      const endStr = phase.endDate ?? phase.startDate;
      const end = parseDate(endStr).getTime();
      if (end > latest) latest = end;
    }
    const rangeStartDate = new Date(earliest);
    const rangeEndDate = new Date(latest);
    const total = Math.max(daysBetween(rangeStartDate, rangeEndDate) + 1, 1);

    const labels: string[] = [];
    const step = Math.max(1, Math.round(total / 5));
    for (let i = 0; i <= total; i += step) {
      const d = new Date(earliest + i * 86400000);
      labels.push(d.getDate().toString());
    }
    const lastDay = rangeEndDate.getDate().toString();
    if (!labels.includes(lastDay)) labels.push(lastDay);

    return { rangeStart: rangeStartDate, totalDays: total, timelineLabels: labels };
  }, [phases]);

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {t("workflow.title")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onPauseAll}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 transition-colors flex items-center gap-1 font-medium"
          >
            <Pause size={10} />
            {t("workflow.pauseAll")}
          </button>
          <button
            onClick={onResumeAll}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20 transition-colors flex items-center gap-1 font-medium"
          >
            <Play size={10} />
            {t("workflow.resumeAll")}
          </button>
          <span className="text-xs text-accent font-semibold ltr-nums">
            {totalProgress}%
          </span>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="w-full h-2 bg-surface-light/50 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${totalProgress}%`,
            background: "linear-gradient(90deg, #006400, #28a745, #DAA520)",
          }}
        />
      </div>

      {/* Phase pipeline */}
      <div className="flex items-start gap-0">
        {phases.map((phase, index) => {
          const isLast = index === phases.length - 1;

          return (
            <div key={phase.id} className="flex-1 relative">
              {/* Connector line */}
              {!isLast && (
                <div
                  className="absolute top-[9px] h-0.5 z-0"
                  style={{
                    insetInlineStart: "50%",
                    width: "100%",
                    backgroundColor:
                      phase.status === "complete"
                        ? "var(--color-success)"
                        : "rgba(42, 74, 127, 0.3)",
                  }}
                />
              )}

              {/* Phase content */}
              <div className="flex flex-col items-center relative z-10">
                <div className="mb-2 bg-surface p-0.5 rounded-full">
                  {getPhaseIcon(phase.status)}
                </div>
                <p
                  className={cn(
                    "text-[11px] font-medium text-center mb-1",
                    phase.status === "complete" && "text-success",
                    phase.status === "active" && "text-accent",
                    phase.status === "pending" && "text-text-muted/50"
                  )}
                >
                  {isAr ? phase.nameAr : phase.name}
                </p>

                {/* Progress bar per phase */}
                <div className="w-full max-w-[60px] h-1 bg-surface-light/50 rounded-full overflow-hidden mb-1">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      phase.status === "complete" && "bg-success",
                      phase.status === "active" && "bg-accent",
                      phase.status === "pending" && "bg-text-muted/20"
                    )}
                    style={{ width: `${phase.progress}%` }}
                  />
                </div>

                <p className="text-[9px] text-text-muted ltr-nums">
                  {phase.progress}%
                </p>

                {/* Checkpoints */}
                <div className="flex gap-0.5 mt-1">
                  {Array.from({ length: phase.checkpoints }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        i < phase.checkpointsComplete
                          ? "bg-success"
                          : "bg-text-muted/20"
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Gantt-style timeline */}
      <div className="mt-5 pt-4 border-t border-border/30">
        <div className="space-y-1.5">
          {phases.map((phase) => {
            const phaseStart = parseDate(phase.startDate);
            const phaseEnd = phase.endDate ? parseDate(phase.endDate) : phaseStart;
            const startOffset = (daysBetween(rangeStart, phaseStart) / totalDays) * 100;
            const width = ((daysBetween(phaseStart, phaseEnd) + 1) / totalDays) * 100;

            return (
              <div key={phase.id} className="flex items-center gap-2">
                <span className="text-[9px] text-text-muted w-16 truncate text-end">
                  {isAr ? phase.nameAr : phase.name}
                </span>
                <div className="flex-1 h-3 bg-surface-light/20 rounded relative overflow-hidden">
                  <div
                    className={cn(
                      "absolute top-0 h-full rounded transition-all",
                      phase.status === "complete" && "bg-success/40",
                      phase.status === "active" && "bg-accent/40",
                      phase.status === "pending" && "bg-text-muted/10"
                    )}
                    style={{
                      insetInlineStart: `${startOffset}%`,
                      width: `${width}%`,
                    }}
                  >
                    {/* Fill based on progress */}
                    <div
                      className={cn(
                        "h-full rounded",
                        phase.status === "complete" && "bg-success",
                        phase.status === "active" && "bg-accent",
                        phase.status === "pending" && "bg-text-muted/20"
                      )}
                      style={{ width: `${phase.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Timeline labels */}
        <div className="flex justify-between mt-1 ps-[72px]">
          {timelineLabels.map((day, i) => (
            <span key={`${day}-${i}`} className="text-[8px] text-text-muted/50 ltr-nums">
              {day}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
