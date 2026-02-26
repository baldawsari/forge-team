"use client";

import React, { useEffect, useState } from "react";
import { ListTodo, Bot, TrendingUp, DollarSign, Hash } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn, formatCost } from "@/lib/utils";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  suffix?: string;
}

function StatCard({ icon, label, value, color, suffix }: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = typeof value === "number" ? value : parseFloat(value);

  useEffect(() => {
    if (isNaN(numericValue)) {
      return;
    }
    const duration = 1000;
    const steps = 30;
    const increment = numericValue / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= numericValue) {
        setDisplayValue(numericValue);
        clearInterval(timer);
      } else {
        setDisplayValue(current);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [numericValue]);

  return (
    <div className="glass-card p-4 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}20`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-text-secondary text-xs font-medium">{label}</p>
        <p className="text-xl font-bold text-text-primary ltr-nums">
          <span className="counter-animate">
            {typeof value === "string" && value.startsWith("$")
              ? `$${displayValue.toFixed(2)}`
              : suffix === "%"
                ? `${Math.round(displayValue)}%`
                : suffix === "K"
                  ? `${Math.round(displayValue)}K`
                  : Math.round(displayValue)}
          </span>
        </p>
      </div>
    </div>
  );
}

interface StatsBarProps {
  activeTasks: number;
  workingAgents: number;
  sprintProgress: number;
  todayCost: number;
  totalTokens?: number;
}

export default function StatsBar({
  activeTasks,
  workingAgents,
  sprintProgress,
  todayCost,
  totalTokens,
}: StatsBarProps) {
  const { t } = useLocale();

  const tokensInK = totalTokens ? Math.round(totalTokens / 1000) : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard
        icon={<ListTodo size={24} />}
        label={t("stats.activeTasks")}
        value={activeTasks}
        color="#3b82f6"
      />
      <StatCard
        icon={<Bot size={24} />}
        label={t("stats.workingAgents")}
        value={workingAgents}
        color="#28a745"
      />
      <StatCard
        icon={<TrendingUp size={24} />}
        label={t("stats.sprintProgress")}
        value={sprintProgress}
        color="#DAA520"
        suffix="%"
      />
      <StatCard
        icon={<DollarSign size={24} />}
        label={t("stats.todayCost")}
        value={`$${todayCost}`}
        color="#dc3545"
      />
      <StatCard
        icon={<Hash size={24} />}
        label={t("stats.totalTokens")}
        value={tokensInK}
        color="#8b5cf6"
        suffix="K"
      />
    </div>
  );
}
