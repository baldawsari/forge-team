"use client";

import React, { useState, useMemo } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Sparkles, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn, formatTokens, formatCost } from "@/lib/utils";
import { saveModelAssignments } from "@/lib/api";
import { toast } from "sonner";
import type { Agent, CostDay } from "@/lib/mock-data";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

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

type AgentModelRow = {
  id: string;
  name: string;
  nameAr: string;
  avatar: string;
  primary: string;
  fallback: string;
  fallback2: string;
  temperature: number;
  tokensUsed: number;
  cost: number;
  dailyCap: number;
};

const columnHelper = createColumnHelper<AgentModelRow>();

export default function ModelsCostPanel({
  agents,
  costHistory,
  dailyBudget,
  todayCost,
}: ModelsCostPanelProps) {
  const { locale, t, direction } = useLocale();
  const isAr = locale === "ar";

  const [agentModels, setAgentModels] = useState<
    Record<string, { primary: string; fallback: string; fallback2: string; temperature: number; dailyCap: number }>
  >(
    Object.fromEntries(
      agents.map((a) => [
        a.id,
        {
          primary: a.model,
          fallback: a.fallbackModel,
          fallback2: (a as any).fallback2Model ?? "",
          temperature: a.temperature,
          dailyCap: a.dailyCap ?? 8,
        },
      ])
    )
  );
  const [showOptimizeToast, setShowOptimizeToast] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [nameFilter, setNameFilter] = useState("");

  const budgetPercentage = Math.min((todayCost / dailyBudget) * 100, 100);
  const budgetColor =
    budgetPercentage > 80 ? "#dc3545" : budgetPercentage > 60 ? "#f59e0b" : "#28a745";

  const handleOptimize = () => {
    setShowOptimizeToast(true);
    setTimeout(() => setShowOptimizeToast(false), 5000);
  };

  const handleSave = async () => {
    try {
      await saveModelAssignments(agentModels);
      toast.success(t("cost.saved"));
    } catch {
      toast.error(t("cost.saveFailed"));
    }
  };

  const data = useMemo<AgentModelRow[]>(() => {
    return agents.map((agent) => {
      const models = agentModels[agent.id];
      return {
        id: agent.id,
        name: agent.name,
        nameAr: agent.nameAr,
        avatar: agent.avatar,
        primary: models?.primary ?? agent.model,
        fallback: models?.fallback ?? agent.fallbackModel,
        fallback2: models?.fallback2 ?? "",
        temperature: models?.temperature ?? agent.temperature,
        tokensUsed: agent.tokensUsed,
        cost: agent.cost,
        dailyCap: models?.dailyCap ?? (agent.dailyCap ?? 8),
      };
    });
  }, [agents, agentModels]);

  const columns = useMemo(() => [
    columnHelper.accessor((row) => (isAr ? row.nameAr : row.name), {
      id: "agent",
      header: () => t("cost.agent"),
      cell: (info) => (
        <div className="flex items-center gap-2">
          <span>{info.row.original.avatar}</span>
          <span className="text-text-primary font-medium">
            {info.getValue()}
          </span>
        </div>
      ),
      filterFn: "includesString",
    }),
    columnHelper.accessor("primary", {
      header: () => t("cost.primaryModel"),
      cell: (info) => (
        <select
          value={info.getValue()}
          onChange={(e) =>
            setAgentModels((prev) => ({
              ...prev,
              [info.row.original.id]: { ...prev[info.row.original.id], primary: e.target.value },
            }))
          }
          className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("fallback", {
      header: () => t("cost.fallbackModel"),
      cell: (info) => (
        <select
          value={info.getValue()}
          onChange={(e) =>
            setAgentModels((prev) => ({
              ...prev,
              [info.row.original.id]: { ...prev[info.row.original.id], fallback: e.target.value },
            }))
          }
          className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("fallback2", {
      header: () => t("cost.fallback2Model"),
      cell: (info) => (
        <select
          value={info.getValue()}
          onChange={(e) =>
            setAgentModels((prev) => ({
              ...prev,
              [info.row.original.id]: { ...prev[info.row.original.id], fallback2: e.target.value },
            }))
          }
          className="bg-surface-light/50 text-text-primary text-xs rounded px-2 py-1 border border-border/30 focus:outline-none focus:border-primary/50"
        >
          <option value="">--</option>
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("temperature", {
      header: () => t("cost.temperature"),
      cell: (info) => (
        <input
          type="number"
          min={0}
          max={1}
          step={0.1}
          value={info.getValue()}
          onChange={(e) =>
            setAgentModels((prev) => ({
              ...prev,
              [info.row.original.id]: {
                ...prev[info.row.original.id],
                temperature: parseFloat(e.target.value) || 0,
              },
            }))
          }
          className="w-14 bg-surface-light/50 text-text-primary text-xs text-center rounded px-1 py-1 border border-border/30 focus:outline-none focus:border-primary/50 ltr-nums"
        />
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("dailyCap", {
      header: () => t("cost.dailyCap"),
      cell: (info) => (
        <input
          type="number"
          min={0}
          step={5}
          value={info.getValue()}
          onChange={(e) =>
            setAgentModels((prev) => ({
              ...prev,
              [info.row.original.id]: {
                ...prev[info.row.original.id],
                dailyCap: parseFloat(e.target.value) || 0,
              },
            }))
          }
          className="w-16 bg-surface-light/50 text-text-primary text-xs text-center rounded px-1 py-1 border border-border/30 focus:outline-none focus:border-primary/50 ltr-nums"
        />
      ),
      enableSorting: false,
    }),
    columnHelper.accessor("tokensUsed", {
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 text-text-muted font-medium"
          onClick={() => column.toggleSorting()}
        >
          {t("cost.tokensUsed")}
          {column.getIsSorted() === "asc" ? (
            <ArrowUp size={12} />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown size={12} />
          ) : (
            <ArrowUpDown size={12} />
          )}
        </button>
      ),
      cell: (info) => (
        <span className="ltr-nums text-text-primary">
          {formatTokens(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("cost", {
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 text-text-muted font-medium"
          onClick={() => column.toggleSorting()}
        >
          {t("cost.costUsd")}
          {column.getIsSorted() === "asc" ? (
            <ArrowUp size={12} />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown size={12} />
          ) : (
            <ArrowUpDown size={12} />
          )}
        </button>
      ),
      cell: (info) => {
        const cost = info.getValue();
        const dailyCap = info.row.original.dailyCap;
        const overCap = cost > dailyCap;
        return (
          <span
            className={cn(
              "ltr-nums font-medium inline-flex items-center gap-1",
              overCap ? "text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded" : "text-text-primary"
            )}
          >
            {overCap && <AlertTriangle size={12} />}
            {formatCost(cost)}
          </span>
        );
      },
    }),
  ], [isAr, t]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  React.useEffect(() => {
    table.getColumn("agent")?.setFilterValue(nameFilter || undefined);
  }, [nameFilter, table]);

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
              <RechartsTooltip
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

        <div className="mb-3">
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder={t("cost.searchAgent")}
            className="w-full max-w-xs px-3 py-1.5 rounded-lg bg-surface-light/40 border border-border/30 text-xs text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>

        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-border/30">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="py-2 px-2 text-xs text-text-muted font-medium"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="border-b border-border/10 hover:bg-surface-light/20 transition-colors"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2.5 px-2 text-xs">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <tfoot>
            <TableRow className="border-t border-border/40">
              <TableCell colSpan={6} className="py-2.5 px-2 text-xs text-text-secondary font-semibold">
                {t("cost.total")}
              </TableCell>
              <TableCell className="py-2.5 px-2 text-xs text-end ltr-nums text-text-primary font-semibold">
                {formatTokens(agents.reduce((sum, a) => sum + a.tokensUsed, 0))}
              </TableCell>
              <TableCell className="py-2.5 px-2 text-xs text-end ltr-nums text-accent font-bold">
                {formatCost(agents.reduce((sum, a) => sum + a.cost, 0))}
              </TableCell>
            </TableRow>
          </tfoot>
        </Table>

        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            className="text-xs"
          >
            {t("cost.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
