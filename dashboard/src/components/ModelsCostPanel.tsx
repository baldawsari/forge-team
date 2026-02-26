"use client";

import React, { useState } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Sparkles } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn, formatTokens, formatCost } from "@/lib/utils";
import type { Agent, CostDay } from "@/lib/mock-data";

interface ModelsCostPanelProps {
  agents: Agent[];
  costHistory: CostDay[];
  dailyBudget: number;
  todayCost: number;
}

const availableModels = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gemini-3.1-pro",
  "gemini-flash-3",
  "gemini-2.0-flash",
];

export default function ModelsCostPanel({
  agents,
  costHistory,
  dailyBudget,
  todayCost,
}: ModelsCostPanelProps) {
  const { locale, t, direction } = useLocale();
  const isAr = locale === "ar";
  const [agentModels, setAgentModels] = useState<
    Record<string, { primary: string; fallback: string; fallback2: string; temperature: number }>
  >(
    Object.fromEntries(
      agents.map((a) => [
        a.id,
        {
          primary: a.model,
          fallback: a.fallbackModel,
          fallback2: (a as any).fallback2Model ?? "",
          temperature: a.temperature,
        },
      ])
    )
  );
  const [showOptimizeToast, setShowOptimizeToast] = useState(false);

  const budgetPercentage = Math.min((todayCost / dailyBudget) * 100, 100);
  const budgetColor =
    budgetPercentage > 80 ? "#dc3545" : budgetPercentage > 60 ? "#f59e0b" : "#28a745";

  const handleOptimize = () => {
    setShowOptimizeToast(true);
    setTimeout(() => setShowOptimizeToast(false), 5000);
  };

  return (
    <div className="space-y-4 relative">
      {/* Optimize toast */}
      {showOptimizeToast && (
        <div className="fixed top-6 inset-x-0 z-[100] flex justify-center pointer-events-none">
          <div className="pointer-events-auto glass-card px-5 py-3 rounded-xl border border-accent/30 shadow-lg max-w-lg text-center">
            <p className="text-xs text-text-primary">
              {t("cost.optimizeSuggestion")}
            </p>
          </div>
        </div>
      )}

      {/* Cost chart */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">
            {t("cost.last7Days")}
          </h2>
          <span className="text-xs text-text-muted ltr-nums">
            {t("cost.dailyBudget")}: ${dailyBudget.toFixed(2)}
          </span>
        </div>

        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={costHistory}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#006400" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#006400" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(42,74,127,0.2)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#a0a0b8" }}
                axisLine={{ stroke: "rgba(42,74,127,0.3)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#a0a0b8" }}
                axisLine={{ stroke: "rgba(42,74,127,0.3)" }}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
                orientation={direction === "rtl" ? "right" : "left"}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a2e",
                  border: "1px solid rgba(42,74,127,0.4)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#e8e8e8",
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, t("agents.cost")]}
              />
              {/* Budget threshold line */}
              <Line
                type="monotone"
                dataKey={() => dailyBudget}
                stroke="#dc3545"
                strokeDasharray="5 5"
                strokeWidth={1}
                dot={false}
                name={t("cost.budgetLimit")}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#006400"
                fill="url(#costGradient)"
                strokeWidth={2}
                dot={{ fill: "#28a745", r: 3 }}
                activeDot={{ r: 5, fill: "#DAA520" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Daily budget bar */}
        <div className="mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-secondary">{t("cost.budgetUsed")}</span>
            <span className="text-xs font-semibold ltr-nums" style={{ color: budgetColor }}>
              ${todayCost.toFixed(2)} / ${dailyBudget.toFixed(2)}
            </span>
          </div>
          <div className="w-full h-3 bg-surface-light/50 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${budgetPercentage}%`,
                backgroundColor: budgetColor,
              }}
            />
          </div>
        </div>
      </div>

      {/* Agent model table */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">{t("cost.title")}</h2>
          <button
            onClick={handleOptimize}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors flex items-center gap-1.5 font-medium"
          >
            <Sparkles size={12} />
            {t("cost.optimize")}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-start py-2 px-2 text-text-muted font-medium">
                  {t("cost.agent")}
                </th>
                <th className="text-start py-2 px-2 text-text-muted font-medium">
                  {t("cost.primaryModel")}
                </th>
                <th className="text-start py-2 px-2 text-text-muted font-medium">
                  {t("cost.fallbackModel")}
                </th>
                <th className="text-start py-2 px-2 text-text-muted font-medium">
                  {t("cost.fallback2Model")}
                </th>
                <th className="text-center py-2 px-2 text-text-muted font-medium">
                  {t("cost.temperature")}
                </th>
                <th className="text-end py-2 px-2 text-text-muted font-medium">
                  {t("cost.tokensUsed")}
                </th>
                <th className="text-end py-2 px-2 text-text-muted font-medium">
                  {t("cost.costUsd")}
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const models = agentModels[agent.id] || {
                  primary: agent.model,
                  fallback: agent.fallbackModel,
                  fallback2: "",
                  temperature: agent.temperature,
                };
                return (
                  <tr
                    key={agent.id}
                    className="border-b border-border/10 hover:bg-surface-light/20 transition-colors"
                  >
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        <span>{agent.avatar}</span>
                        <span className="text-text-primary font-medium">
                          {isAr ? agent.nameAr : agent.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        value={models.primary}
                        onChange={(e) =>
                          setAgentModels((prev) => ({
                            ...prev,
                            [agent.id]: { ...prev[agent.id], primary: e.target.value },
                          }))
                        }
                        className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        value={models.fallback}
                        onChange={(e) =>
                          setAgentModels((prev) => ({
                            ...prev,
                            [agent.id]: { ...prev[agent.id], fallback: e.target.value },
                          }))
                        }
                        className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        value={models.fallback2}
                        onChange={(e) =>
                          setAgentModels((prev) => ({
                            ...prev,
                            [agent.id]: { ...prev[agent.id], fallback2: e.target.value },
                          }))
                        }
                        className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
                      >
                        <option value="">--</option>
                        {availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-2 text-center ltr-nums">
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={models.temperature}
                        onChange={(e) =>
                          setAgentModels((prev) => ({
                            ...prev,
                            [agent.id]: {
                              ...prev[agent.id],
                              temperature: parseFloat(e.target.value) || 0,
                            },
                          }))
                        }
                        className="w-14 bg-surface-light/50 text-text-primary text-xs text-center rounded px-1 py-1 border border-border/30 focus:outline-none focus:border-primary/50 ltr-nums"
                      />
                    </td>
                    <td className="py-2.5 px-2 text-end ltr-nums text-text-primary">
                      {formatTokens(agent.tokensUsed)}
                    </td>
                    <td className="py-2.5 px-2 text-end ltr-nums text-text-primary font-medium">
                      {formatCost(agent.cost)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/40">
                <td colSpan={5} className="py-2.5 px-2 text-text-secondary font-semibold">
                  {t("cost.total")}
                </td>
                <td className="py-2.5 px-2 text-end ltr-nums text-text-primary font-semibold">
                  {formatTokens(agents.reduce((sum, a) => sum + a.tokensUsed, 0))}
                </td>
                <td className="py-2.5 px-2 text-end ltr-nums text-accent font-bold">
                  {formatCost(agents.reduce((sum, a) => sum + a.cost, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
