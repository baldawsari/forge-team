"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, Brain, Database, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/mock-data";
import { mockMemoryData, type AgentMemoryData } from "@/lib/mock-data";
import { searchMemory, fetchMemoryStats } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";

interface MemoryExplorerProps {
  agents: Agent[];
  locale: string;
  direction: string;
}

const scopeOptions = [
  { id: "company", en: "Company KB", ar: "قاعدة معرفة الشركة" },
  { id: "team", en: "Team Memory", ar: "ذاكرة الفريق" },
  { id: "project", en: "Project Memory", ar: "ذاكرة المشروع" },
  { id: "agent", en: "Agent Memory", ar: "ذاكرة الوكيل" },
];

const mockSearchResults = [
  {
    id: "r1",
    title: "Authentication Flow Architecture",
    titleAr: "بنية تدفق المصادقة",
    snippet: "OAuth2 + JWT implementation with refresh token rotation...",
    snippetAr: "تنفيذ OAuth2 + JWT مع تدوير رمز التحديث...",
    source: "Architect Agent",
    sourceAr: "وكيل المعمار",
    score: 0.94,
  },
  {
    id: "r2",
    title: "API Rate Limiting Strategy",
    titleAr: "استراتيجية تحديد معدل API",
    snippet: "Kong gateway configured with 1000 req/min per client...",
    snippetAr: "بوابة Kong مُعدة بـ 1000 طلب/دقيقة لكل عميل...",
    source: "Backend Agent",
    sourceAr: "وكيل الخلفية",
    score: 0.87,
  },
  {
    id: "r3",
    title: "OWASP Audit Findings",
    titleAr: "نتائج تدقيق OWASP",
    snippet: "2 medium-severity input validation issues identified...",
    snippetAr: "تم تحديد مشكلتين متوسطتي الخطورة في التحقق من المدخلات...",
    source: "Security Agent",
    sourceAr: "وكيل الأمان",
    score: 0.81,
  },
];

export default function MemoryExplorer({ agents, locale, direction }: MemoryExplorerProps) {
  const { t } = useLocale();
  const isAr = locale === "ar";
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("team");
  const [searchResults, setSearchResults] = useState(mockSearchResults);
  const [stats, setStats] = useState<any[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchMemoryStats()
      .then(data => setStats(data.stats))
      .catch(() => {});
  }, []);

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    try {
      const data = await searchMemory(q, scope);
      if (data.results.length > 0) {
        setSearchResults(data.results.map((r: any) => ({
          id: r.id,
          title: r.content?.slice(0, 50) ?? 'Memory Entry',
          titleAr: r.content?.slice(0, 50) ?? 'سجل ذاكرة',
          snippet: r.content ?? '',
          snippetAr: r.content ?? '',
          source: r.agentId ?? 'system',
          sourceAr: r.agentId ?? 'النظام',
          score: r.importance ?? 0.5,
        })));
      }
    } catch {
      // Fall back to mock data - already set
    }
  }, [scope]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim()) {
      debounceRef.current = setTimeout(() => performSearch(value), 500);
    }
  }, [performSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const memoryMap = new Map<string, AgentMemoryData>();
  for (const m of mockMemoryData) {
    memoryMap.set(m.agentId, m);
  }

  return (
    <div className="space-y-4" dir={direction}>
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Brain size={16} className="text-primary-light" />
          {t("memory.title")}
        </h2>

        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-text-muted pointer-events-none" />
            <input
              type="text"
              dir="auto"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') performSearch(query); }}
              placeholder={t("memory.search")}
              className="w-full ps-10 pe-4 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="px-3 py-2 rounded-lg bg-surface-light/40 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-primary/50 transition-colors"
          >
            {scopeOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {isAr ? opt.ar : opt.en}
              </option>
            ))}
          </select>
        </div>

        {query.trim() && (
          <div className="space-y-2 mb-4">
            <h3 className="text-xs font-semibold text-text-secondary">
              {t("memory.results")}
            </h3>
            {searchResults.map((result) => (
              <div
                key={result.id}
                className="p-3 rounded-lg bg-surface-light/30 border border-border/20 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-medium text-text-primary" dir="auto">
                    {isAr ? result.titleAr : result.title}
                  </h4>
                  <span className="text-[10px] text-primary-light font-mono ltr-nums">
                    {t("memory.relevance")}: {(result.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-text-muted mb-1" dir="auto">
                  {isAr ? result.snippetAr : result.snippet}
                </p>
                <span className="text-[10px] text-text-muted/60">
                  {isAr ? result.sourceAr : result.source}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((agent) => {
          const mem = memoryMap.get(agent.id);
          return (
            <div
              key={agent.id}
              className="glass-card p-3 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{agent.avatar}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary truncate">
                    {isAr ? agent.nameAr : agent.name}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="p-2 rounded bg-surface-light/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-text-secondary">
                      {t("memory.shortTerm")}
                    </span>
                    {mem && (
                      <span className="text-[10px] text-text-muted/60 flex items-center gap-1 ltr-nums">
                        <Clock size={10} />
                        {mem.shortTermLastUpdated} {t("memory.minutesAgo")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-primary ltr-nums">
                    {mem ? mem.shortTermTokens.toLocaleString() : "0"} {t("memory.tokens")}
                  </p>
                </div>

                <div className="p-2 rounded bg-surface-light/30">
                  <span className="text-[10px] font-semibold text-text-secondary">
                    {t("memory.longTerm")}
                  </span>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-text-primary ltr-nums">
                      {mem ? mem.longTermEntries : 0} {t("memory.entries")}
                    </p>
                    <p className="text-[10px] text-text-muted ltr-nums">
                      {mem ? mem.longTermTokens.toLocaleString() : "0"} {t("memory.tokens")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
