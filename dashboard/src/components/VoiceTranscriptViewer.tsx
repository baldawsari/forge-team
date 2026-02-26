"use client";

import React, { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { mockTranscripts, type VoiceTranscript } from "@/lib/mock-data";

interface VoiceTranscriptViewerProps {
  locale: string;
  direction: string;
}

const labels: Record<string, { en: string; ar: string }> = {
  title: { en: "Voice Transcripts", ar: "النصوص الصوتية" },
  session: { en: "Session", ar: "الجلسة" },
  allSessions: { en: "All Sessions", ar: "جميع الجلسات" },
  language: { en: "Language", ar: "اللغة" },
  all: { en: "All", ar: "الكل" },
  arabic: { en: "Arabic", ar: "العربية" },
  english: { en: "English", ar: "الإنجليزية" },
  confidence: { en: "Confidence", ar: "الثقة" },
  duration: { en: "Duration", ar: "المدة" },
  noTranscripts: { en: "No transcripts found", ar: "لا توجد نصوص" },
  sttLabel: { en: "User → System", ar: "المستخدم → النظام" },
  ttsLabel: { en: "System → User", ar: "النظام → المستخدم" },
};

function l(key: string, locale: string): string {
  return labels[key]?.[locale === "ar" ? "ar" : "en"] ?? key;
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
  const isAr = locale === "ar";
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");

  const sessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of mockTranscripts) {
      ids.add(t.sessionId);
    }
    return Array.from(ids);
  }, []);

  const filtered = useMemo(() => {
    return mockTranscripts.filter((t) => {
      if (sessionFilter !== "all" && t.sessionId !== sessionFilter) return false;
      if (langFilter !== "all" && t.language !== langFilter) return false;
      return true;
    });
  }, [sessionFilter, langFilter]);

  return (
    <div className="glass-card p-4" dir={direction}>
      <h2 className="text-sm font-semibold text-text-primary mb-3">
        {l("title", locale)}
      </h2>

      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="all">{l("allSessions", locale)}</option>
          {sessionIds.map((sid) => (
            <option key={sid} value={sid}>
              {l("session", locale)} {sid.slice(-4)}
            </option>
          ))}
        </select>

        <select
          value={langFilter}
          onChange={(e) => setLangFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
        >
          <option value="all">{l("all", locale)}</option>
          <option value="ar">{l("arabic", locale)}</option>
          <option value="en">{l("english", locale)}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-text-muted/40 text-xs py-8">
          {l("noTranscripts", locale)}
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="p-3 rounded-lg bg-surface-light/30 border border-border/20 hover:border-primary/20 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base" title={t.direction === "stt" ? l("sttLabel", locale) : l("ttsLabel", locale)}>
                    {t.direction === "stt" ? "🎤" : "🔊"}
                  </span>
                  <span className="text-[10px] text-text-muted/60">
                    {t.direction === "stt" ? l("sttLabel", locale) : l("ttsLabel", locale)}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      t.language === "ar"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-blue-500/20 text-blue-400"
                    )}
                  >
                    {t.language.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-text-muted ltr-nums">
                    {t.duration}
                  </span>
                  <span className="text-[10px] text-text-muted/60 ltr-nums">
                    {formatTimestamp(t.timestamp, locale)}
                  </span>
                </div>
              </div>

              <p className="text-sm text-text-primary mb-2" dir="auto">
                {t.text}
              </p>

              {t.direction === "stt" && t.confidence != null && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">
                    {l("confidence", locale)}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-light/50 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        t.confidence >= 0.9
                          ? "bg-emerald-500"
                          : t.confidence >= 0.7
                            ? "bg-amber-500"
                            : "bg-red-500"
                      )}
                      style={{ width: `${t.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted ltr-nums">
                    {(t.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
