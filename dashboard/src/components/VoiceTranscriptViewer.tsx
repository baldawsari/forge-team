"use client";

import React, { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { mockTranscripts, type VoiceTranscript } from "@/lib/mock-data";
import { useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VoiceTranscriptViewerProps {
  locale: string;
  direction: string;
}

function formatTimestamp(ts: string, locale: string): string {
  const date = new Date(ts);
  return date.toLocaleTimeString(locale === "ar" ? "ar-SA" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function VoiceTranscriptViewer({ locale, direction }: VoiceTranscriptViewerProps) {
  const { t } = useLocale();
  const { on } = useSocket();
  const isAr = locale === "ar";
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>(mockTranscripts);
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");

  useEffect(() => {
    const unsub = on('voice_transcript' as any, (data: any) => {
      const newTranscript: VoiceTranscript = {
        id: data.id,
        timestamp: data.timestamp,
        direction: data.direction,
        language: data.language as "ar" | "en",
        text: data.text,
        confidence: data.confidence,
        duration: typeof data.duration === 'string' ? parseFloat(data.duration) : data.duration,
        sessionId: data.sessionId,
      };
      setTranscripts((prev) => [...prev, newTranscript]);
    });
    return unsub;
  }, [on]);

  const sessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of transcripts) {
      ids.add(t.sessionId);
    }
    return Array.from(ids);
  }, [transcripts]);

  const filtered = useMemo(() => {
    return transcripts.filter((tr) => {
      if (sessionFilter !== "all" && tr.sessionId !== sessionFilter) return false;
      if (langFilter !== "all" && tr.language !== langFilter) return false;
      return true;
    });
  }, [transcripts, sessionFilter, langFilter]);

  return (
    <div className="glass-card p-4" dir={direction}>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        {t("voice.title")}
      </h2>

      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="all">{t("voice.allSessions")}</option>
          {sessionIds.map((sid) => (
            <option key={sid} value={sid}>
              {t("voice.session")} {sid.slice(-4)}
            </option>
          ))}
        </select>

        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="all">{t("voice.all")}</option>
          <option value="ar">{t("voice.arabic")}</option>
          <option value="en">{t("voice.english")}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-text-muted/40 text-xs py-8">
          {t("voice.noTranscripts")}
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          <TooltipProvider>
            {filtered.map((tr) => (
              <div
                key={tr.id}
                className="p-3 rounded-lg bg-surface-light/30 border border-border/20 hover:border-primary/20 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-base cursor-default">
                          {tr.direction === "stt" ? "🎤" : "🔊"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">
                          {tr.direction === "stt" ? t("voice.sttLabel") : t("voice.ttsLabel")}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-[10px] text-text-muted/60">
                      {tr.direction === "stt" ? t("voice.sttLabel") : t("voice.ttsLabel")}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                        tr.language === "ar"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-blue-500/20 text-blue-400"
                      )}
                    >
                      {tr.language.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-text-muted ltr-nums">
                      {tr.duration}
                    </span>
                    <span className="text-[10px] text-text-muted/60 ltr-nums">
                      {formatTimestamp(tr.timestamp, locale)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-text-primary mb-2" dir="auto">
                  {tr.text}
                </p>

                {tr.direction === "stt" && tr.confidence != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">
                      {t("voice.confidence")}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-surface-light/50 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          tr.confidence >= 0.9
                            ? "bg-emerald-500"
                            : tr.confidence >= 0.7
                              ? "bg-amber-500"
                              : "bg-red-500"
                        )}
                        style={{ width: `${tr.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted ltr-nums">
                      {(tr.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
