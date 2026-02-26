"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { LocaleProvider, useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import {
  mockAgents,
  mockTasks,
  mockMessages,
  mockWorkflowPhases,
  mockCostHistory,
  dailyBudget,
  type Agent,
  type Task,
  type Message,
  type WorkflowPhase,
  type DelegationEntry,
} from "@/lib/mock-data";
import {
  fetchAgents as apiFetchAgents,
  fetchTasks as apiFetchTasks,
  fetchHealth,
  fetchModelAssignments,
  fetchModelCosts,
  fetchViadpDelegations,
  updateTask,
  type GatewayAgent,
  type ModelAssignment,
} from "@/lib/api";

import Sidebar from "@/components/Sidebar";
import StatsBar from "@/components/StatsBar";
import KanbanBoard from "@/components/KanbanBoard";
import AgentStatusGrid from "@/components/AgentStatusGrid";
import MessageFeed from "@/components/MessageFeed";
import WorkflowProgress from "@/components/WorkflowProgress";
import ModelsCostPanel from "@/components/ModelsCostPanel";
import ViadpAuditLog from "@/components/ViadpAuditLog";
import ConversationPanel from "@/components/ConversationPanel";
import MemoryExplorer from "@/components/MemoryExplorer";
import VoiceTranscriptViewer from "@/components/VoiceTranscriptViewer";

// --- Agent metadata lookup for the 12 known BMAD agents ---
const AGENT_META: Record<
  string,
  {
    nameAr: string;
    role: string;
    roleAr: string;
    avatar: string;
    defaultModel: string;
    defaultFallback: string;
  }
> = {
  "bmad-master": {
    nameAr: "بي ماد ماستر",
    role: "Orchestrator / Team Lead",
    roleAr: "المنسق / قائد الفريق",
    avatar: "\uD83C\uDFAF",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "product-owner": {
    nameAr: "مالك المنتج",
    role: "Requirements & Prioritization",
    roleAr: "المتطلبات والأولويات",
    avatar: "\uD83D\uDCCB",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "business-analyst": {
    nameAr: "محلل الأعمال",
    role: "Research & Analysis",
    roleAr: "البحث والتحليل",
    avatar: "\uD83D\uDCCA",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "scrum-master": {
    nameAr: "سكرم ماستر",
    role: "Agile Coordination",
    roleAr: "التنسيق الرشيق",
    avatar: "\u26A1",
    defaultModel: "gemini-flash-3",
    defaultFallback: "claude-haiku-4-5",
  },
  architect: {
    nameAr: "المعماري",
    role: "System Design",
    roleAr: "تصميم النظام",
    avatar: "\uD83C\uDFD7\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "gemini-3.1-pro",
  },
  "ux-designer": {
    nameAr: "مصمم UX/UI",
    role: "User Experience",
    roleAr: "تجربة المستخدم",
    avatar: "\uD83C\uDFA8",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "frontend-dev": {
    nameAr: "مطور الواجهة",
    role: "Frontend Code",
    roleAr: "كود الواجهة",
    avatar: "\uD83D\uDCBB",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "backend-dev": {
    nameAr: "مطور الخلفية",
    role: "Backend & APIs",
    roleAr: "الخلفية والـ APIs",
    avatar: "\u2699\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "claude-sonnet-4-6",
  },
  "qa-architect": {
    nameAr: "مهندس الجودة",
    role: "Testing & QA",
    roleAr: "الاختبار والجودة",
    avatar: "\uD83D\uDD0D",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "claude-sonnet-4-6",
  },
  "devops-engineer": {
    nameAr: "مهندس DevOps",
    role: "CI/CD & Infrastructure",
    roleAr: "البنية التحتية",
    avatar: "\uD83D\uDE80",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "security-specialist": {
    nameAr: "الأمن والامتثال",
    role: "Security & Compliance",
    roleAr: "الأمن والامتثال",
    avatar: "\uD83D\uDEE1\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "gemini-3.1-pro",
  },
  "tech-writer": {
    nameAr: "الكاتب التقني",
    role: "Documentation",
    roleAr: "التوثيق",
    avatar: "\uD83D\uDCDD",
    defaultModel: "claude-sonnet-4-6",
    defaultFallback: "gemini-3.1-pro",
  },
};

// Map a gateway agent + model assignments + cost data to the dashboard Agent interface
function mapGatewayAgent(
  gw: GatewayAgent,
  assignments: Record<string, ModelAssignment>,
  costByAgent: Record<string, { cost: number; requests: number; tokens: number }>
): Agent {
  const meta = AGENT_META[gw.id];
  const assignment = assignments[gw.id];
  const costInfo = costByAgent[gw.id];

  const status = (["idle", "working", "reviewing", "blocked"].includes(gw.status)
    ? gw.status
    : "idle") as Agent["status"];

  return {
    id: gw.id,
    name: meta?.role ? `${gw.name}` : gw.name,
    nameAr: meta?.nameAr ?? gw.name,
    role: meta?.role ?? gw.role,
    roleAr: meta?.roleAr ?? gw.role,
    avatar: meta?.avatar ?? "\uD83E\uDD16",
    status,
    currentTask: gw.currentTaskId,
    currentTaskAr: gw.currentTaskId,
    model: assignment?.primary ?? meta?.defaultModel ?? "gemini-3.1-pro",
    fallbackModel: assignment?.fallback ?? meta?.defaultFallback ?? "claude-sonnet-4-6",
    temperature: 0.3,
    tokensUsed: costInfo?.tokens ?? 0,
    cost: costInfo?.cost ?? 0,
  };
}

// Map gateway task status values to dashboard column names
const statusToColumn: Record<string, Task["column"]> = {
  backlog: "backlog",
  todo: "todo",
  "in-progress": "inProgress",
  review: "review",
  done: "done",
  cancelled: "done",
};

// Map gateway tasks to the dashboard Task interface
function mapGatewayTask(gw: {
  id: string;
  title: string;
  description: string;
  status: string;
  assignedTo: string | null;
  priority: string;
  createdAt: string;
  artifacts?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}): Task {
  const column = statusToColumn[gw.status] ?? "backlog";

  const validPriorities = ["critical", "high", "medium", "low"];
  const priority = (validPriorities.includes(gw.priority) ? gw.priority : "medium") as Task["priority"];

  return {
    id: gw.id,
    title: gw.title,
    titleAr: gw.title,
    description: gw.description,
    descriptionAr: gw.description,
    column,
    assignedAgent: gw.assignedTo,
    priority,
    startTime: gw.createdAt || new Date().toISOString(),
    artifacts: gw.artifacts,
  };
}

// Map gateway VIADP delegations to the dashboard DelegationEntry interface
function mapGatewayDelegation(gw: {
  id: string;
  delegator: string;
  delegatee: string;
  task: string;
  taskAr?: string;
  trustScore: number;
  status: string;
  timestamp: string;
  proofChain: string[];
}): DelegationEntry {
  const validStatuses = ["verified", "pending", "failed"];
  const status = (validStatuses.includes(gw.status) ? gw.status : "pending") as DelegationEntry["status"];

  return {
    id: gw.id,
    delegator: gw.delegator,
    delegatee: gw.delegatee,
    task: gw.task,
    taskAr: gw.taskAr ?? gw.task,
    trustScore: gw.trustScore,
    status,
    timestamp: gw.timestamp,
    proofChain: gw.proofChain ?? [],
  };
}

function DashboardContent() {
  const { locale, direction, t } = useLocale();
  const { isConnected, on } = useSocket();

  const [activeTab, setActiveTab] = useState("dashboard");
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Data state - start with mock data as fallback
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [workflowPhases, setWorkflowPhases] = useState<WorkflowPhase[]>(mockWorkflowPhases);
  const [delegations, setDelegations] = useState<DelegationEntry[]>([]);
  const [todayCost, setTodayCost] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Cache model assignments and cost data for mapping
  const assignmentsRef = useRef<Record<string, ModelAssignment>>({});
  const costByAgentRef = useRef<Record<string, { cost: number; requests: number; tokens: number }>>({});

  // Fetch all data from gateway
  const loadData = useCallback(async () => {
    try {
      // Fetch agents, tasks, models, costs, and delegations in parallel
      const results = await Promise.allSettled([
        apiFetchAgents(),
        apiFetchTasks(),
        fetchModelAssignments(),
        fetchModelCosts(),
        fetchViadpDelegations(),
      ]);

      // Process model assignments
      if (results[2].status === "fulfilled") {
        assignmentsRef.current = results[2].value.assignments;
      }

      // Process cost data
      if (results[3].status === "fulfilled") {
        costByAgentRef.current = results[3].value.summary.perAgent ?? {};
        setTodayCost(results[3].value.summary.totalCost ?? 0);
      }

      // Process agents (needs assignments and costs) - fall back to mockAgents on failure
      if (results[0].status === "fulfilled") {
        const mapped = results[0].value.agents.map((gw) =>
          mapGatewayAgent(gw, assignmentsRef.current, costByAgentRef.current)
        );
        setAgents(mapped);
      } else {
        setAgents((prev) => (prev.length === 0 ? mockAgents : prev));
      }

      // Process tasks - fall back to mockTasks on failure
      if (results[1].status === "fulfilled") {
        const mapped = results[1].value.tasks.map(mapGatewayTask);
        setTasks(mapped);
      } else {
        setTasks((prev) => (prev.length === 0 ? mockTasks : prev));
      }

      // Process delegations
      if (results[4].status === "fulfilled") {
        const mapped = results[4].value.delegations.map(mapGatewayDelegation);
        setDelegations(mapped);
      }
    } catch (err) {
      console.error("Failed to load data from gateway:", err);
      // On total failure, fall back to mock data
      setAgents((prev) => (prev.length === 0 ? mockAgents : prev));
      setTasks((prev) => (prev.length === 0 ? mockTasks : prev));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial data load + polling
  useEffect(() => {
    loadData();

    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Listen for socket events (real-time overlay on top of polling)
  useEffect(() => {
    const unsubStatus = on("agent_status", (data) => {
      // Resolve the effective status from the event (newStatus or status field)
      const effectiveStatus = (data.newStatus ?? data.status) as Agent["status"] | undefined;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === data.agentId
            ? {
                ...a,
                status: effectiveStatus ?? a.status,
                currentTask: data.currentTask !== undefined ? data.currentTask : a.currentTask,
                model: data.model ?? a.model,
              }
            : a
        )
      );
    });

    const unsubTask = on("task_update", (data) => {
      // The gateway task_update event has a nested event object
      const evt = data.event;
      if (!evt) return;

      setTasks((prev) => {
        const exists = prev.some((t) => t.id === evt.taskId);
        if (!exists && data.type === "created") {
          // Append newly created tasks
          const column = statusToColumn[evt.currentStatus] ?? "backlog";
          return [
            ...prev,
            {
              id: evt.taskId,
              title: evt.data?.title ?? "Untitled",
              titleAr: evt.data?.title ?? "Untitled",
              description: "",
              descriptionAr: "",
              column,
              assignedAgent: evt.data?.assignedTo ?? null,
              priority: (evt.data?.priority || "medium") as Task["priority"],
              startTime: evt.timestamp,
            },
          ];
        }
        // Update existing tasks
        return prev.map((t) => {
          if (t.id !== evt.taskId) return t;
          const column = statusToColumn[evt.currentStatus] ?? t.column;
          return {
            ...t,
            column,
            title: evt.data?.title ?? t.title,
            assignedAgent: evt.data?.assignedTo ?? t.assignedAgent,
            priority: (evt.data?.priority || t.priority) as Task["priority"],
          };
        });
      });
    });

    // Append new messages from WebSocket
    const unsubMessage = on("message", (data) => {
      if (data && data.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev, data as unknown as Message];
        });
      }
    });

    // Workflow updates
    const unsubWorkflow = on("workflow_update", (data) => {
      if (data && data.phase) {
        setWorkflowPhases((prev) =>
          prev.map((p) =>
            p.name === data.phase ? { ...p, status: data.status, progress: data.progress } : p
          )
        );
      }
    });

    // Session and VIADP events trigger a full data refresh
    const unsubSession = on("session_update", () => {
      loadData();
    });

    const unsubViadp = on("viadp_update", () => {
      loadData();
    });

    return () => {
      unsubStatus();
      unsubTask();
      unsubMessage();
      unsubWorkflow();
      unsubSession();
      unsubViadp();
    };
  }, [on, loadData]);

  const handleTaskMove = useCallback((taskId: string, newColumn: Task["column"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, column: newColumn } : t))
    );
    // Persist the move to the gateway
    const columnToStatus: Record<string, string> = {
      backlog: "backlog",
      todo: "todo",
      inProgress: "in-progress",
      review: "review",
      done: "done",
    };
    updateTask(taskId, { status: columnToStatus[newColumn] ?? newColumn }).catch((err) => {
      console.error("Failed to update task on gateway:", err);
    });
  }, []);

  // Computed stats
  const activeTasks = tasks.filter(
    (t) => t.column === "inProgress" || t.column === "review"
  ).length;
  const workingAgents = agents.filter(
    (a) => a.status === "working" || a.status === "reviewing"
  ).length;
  const doneTasks = tasks.filter((t) => t.column === "done").length;
  const sprintProgress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;

  // Update document direction, language, and dark mode when state changes
  useEffect(() => {
    document.documentElement.setAttribute("dir", direction);
    document.documentElement.setAttribute("lang", locale);
    document.documentElement.classList.toggle("dark", isDarkMode);
    document.documentElement.classList.toggle("light", !isDarkMode);
  }, [locale, direction, isDarkMode]);

  // Tab heading lookup
  const tabHeadings: Record<string, string> = {
    dashboard: t("nav.dashboard"),
    conversation: t("nav.conversation") || (locale === "ar" ? "المحادثة" : "Conversation"),
    kanban: t("nav.kanban"),
    agents: t("nav.agents"),
    workflows: t("nav.workflows"),
    memory: t("nav.memory"),
    modelsCost: t("nav.modelsCost"),
    viadpAudit: t("nav.viadpAudit"),
    settings: t("nav.settings"),
    "voice-transcripts": locale === "ar" ? "النصوص الصوتية" : "Voice Transcripts",
  };

  // Responsive: detect mobile
  const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="min-h-screen">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isDarkMode={isDarkMode}
          onToggleTheme={() => setIsDarkMode(!isDarkMode)}
          {...({ onCollapse: setSidebarCollapsed, mobileMenuOpen } as Record<string, unknown>)}
        />
        <main
          className="transition-all duration-300 min-h-screen"
          style={{ paddingInlineStart: isMobile ? "0" : sidebarCollapsed ? "68px" : "240px" }}
        >
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-center h-[60vh]">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-text-muted">
                  {t("common.loading") || (locale === "ar" ? "جارٍ الاتصال بالبوابة..." : "Connecting to gateway...")}
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Mobile hamburger button */}
      {isMobile && (
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="fixed top-4 z-[60] p-2 rounded-lg bg-surface-light/80 backdrop-blur-sm border border-border/30"
          style={{ insetInlineStart: "12px" }}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-primary">
            {mobileMenuOpen ? (
              <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
            ) : (
              <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>
            )}
          </svg>
        </button>
      )}

      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (isMobile) setMobileMenuOpen(false);
        }}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        {...({ onCollapse: setSidebarCollapsed, mobileMenuOpen } as Record<string, unknown>)}
      />

      <main
        className="transition-all duration-300 min-h-screen"
        style={{
          paddingInlineStart: isMobile ? "0" : sidebarCollapsed ? "68px" : "240px",
        }}
      >
        <div className="p-6 space-y-6">
          {/* Connection status indicator */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text-primary">
              {tabHeadings[activeTab] ?? activeTab}
            </h1>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-success" : "bg-text-muted/30"
                }`}
              />
              <span className="text-[10px] text-text-muted">
                {isConnected
                  ? t("common.connected") || (locale === "ar" ? "متصل" : "Connected")
                  : t("common.offline") || (locale === "ar" ? "غير متصل" : "Offline")}
              </span>
            </div>
          </div>

          {/* Dashboard view */}
          {activeTab === "dashboard" && (
            <>
              <StatsBar
                activeTasks={activeTasks}
                workingAgents={workingAgents}
                sprintProgress={sprintProgress}
                todayCost={todayCost}
              />

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Kanban - main area */}
                <div className="lg:col-span-3">
                  <KanbanBoard
                    tasks={tasks}
                    agents={agents}
                    onTaskMove={handleTaskMove}
                  />
                </div>

                {/* Agent status grid - right sidebar */}
                <div className="lg:col-span-1">
                  <AgentStatusGrid agents={agents} />
                </div>
              </div>

              {/* Bottom row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <MessageFeed messages={messages} />
                <WorkflowProgress phases={workflowPhases} />
              </div>
            </>
          )}

          {/* Conversation view */}
          {activeTab === "conversation" && (
            <ConversationPanel agents={agents} />
          )}

          {/* Kanban full view */}
          {activeTab === "kanban" && (
            <KanbanBoard
              tasks={tasks}
              agents={agents}
              onTaskMove={handleTaskMove}
            />
          )}

          {/* Agents full view */}
          {activeTab === "agents" && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {agents.length === 0 ? (
                <div className="col-span-full text-center text-text-muted/40 text-sm py-16">
                  {locale === "ar" ? "لا يوجد وكلاء متصلين" : "No agents connected"}
                </div>
              ) : (
                agents.map((agent) => (
                  <div key={agent.id} className="glass-card p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-3xl">{agent.avatar}</span>
                      <div>
                        <h3 className="text-sm font-bold text-text-primary">
                          {locale === "ar" ? agent.nameAr : agent.name}
                        </h3>
                        <p className="text-xs text-text-secondary">
                          {locale === "ar" ? agent.roleAr : agent.role}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`status-dot ${agent.status}`}
                      />
                      <span className="text-xs text-text-muted capitalize">
                        {t(`agents.${agent.status}`) || agent.status}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary bidi-auto mb-2">
                      {agent.currentTask
                        ? locale === "ar"
                          ? agent.currentTaskAr
                          : agent.currentTask
                        : locale === "ar"
                          ? "لا يوجد مهمة"
                          : "No active task"}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-text-muted pt-2 border-t border-border/20">
                      <span className="ltr-nums">{agent.model}</span>
                      <span className="ltr-nums">${agent.cost.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Workflows view */}
          {activeTab === "workflows" && (
            <WorkflowProgress phases={workflowPhases} />
          )}

          {/* Memory view */}
          {activeTab === "memory" && (
            <MemoryExplorer agents={agents} locale={locale} direction={direction} />
          )}

          {/* Voice Transcripts view */}
          {activeTab === "voice-transcripts" && (
            <VoiceTranscriptViewer locale={locale} direction={direction} />
          )}

          {/* Models & Cost view */}
          {activeTab === "modelsCost" && (
            <ModelsCostPanel
              agents={agents}
              costHistory={mockCostHistory}
              dailyBudget={dailyBudget}
              todayCost={todayCost}
            />
          )}

          {/* VIADP Audit view */}
          {activeTab === "viadpAudit" && (
            <ViadpAuditLog delegations={delegations} agents={agents} />
          )}

          {/* Settings view */}
          {activeTab === "settings" && (
            <div className="glass-card p-6 max-w-2xl">
              <h2 className="text-lg font-semibold text-text-primary mb-6">
                {t("nav.settings")}
              </h2>

              <div className="space-y-6">
                {/* Gateway URL */}
                <div>
                  <label className="block text-sm text-text-secondary mb-2">
                    {t("settings.gatewayUrl") || (locale === "ar" ? "عنوان البوابة" : "Gateway URL")}
                  </label>
                  <input
                    type="text"
                    defaultValue="ws://localhost:3001"
                    className="w-full bg-surface-light/50 text-text-primary text-sm rounded-lg px-4 py-2.5 border border-border/30 focus:outline-none focus:border-primary/50 ltr-nums"
                    dir="ltr"
                  />
                </div>

                {/* Default model */}
                <div>
                  <label className="block text-sm text-text-secondary mb-2">
                    {t("settings.defaultModel") || (locale === "ar" ? "النموذج الافتراضي" : "Default Model")}
                  </label>
                  <select className="w-full bg-surface-light/50 text-text-primary text-sm rounded-lg px-4 py-2.5 border border-border/30 focus:outline-none focus:border-primary/50">
                    <option>claude-opus-4-6</option>
                    <option>claude-sonnet-4-6</option>
                    <option>claude-haiku-4-5</option>
                    <option>gemini-3.1-pro</option>
                    <option>gemini-flash-3</option>
                    <option>gemini-2.0-flash</option>
                  </select>
                </div>

                {/* Budget limit */}
                <div>
                  <label className="block text-sm text-text-secondary mb-2">
                    {t("settings.dailyBudgetLimit") || (locale === "ar" ? "حد الميزانية اليومية ($)" : "Daily Budget Limit ($)")}
                  </label>
                  <input
                    type="number"
                    defaultValue={75}
                    className="w-full bg-surface-light/50 text-text-primary text-sm rounded-lg px-4 py-2.5 border border-border/30 focus:outline-none focus:border-primary/50 ltr-nums"
                    dir="ltr"
                  />
                </div>

                {/* Auto-scroll messages */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">
                    {t("settings.autoScroll") || (locale === "ar" ? "التمرير التلقائي للرسائل" : "Auto-scroll Messages")}
                  </span>
                  <button className="w-12 h-6 rounded-full bg-primary relative transition-colors">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all" style={{ insetInlineEnd: "2px" }} />
                  </button>
                </div>

                {/* Notifications */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">
                    {t("settings.escalationNotifications") || (locale === "ar" ? "إشعارات التصعيد" : "Escalation Notifications")}
                  </span>
                  <button className="w-12 h-6 rounded-full bg-primary relative transition-colors">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all" style={{ insetInlineEnd: "2px" }} />
                  </button>
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-border/30">
                  <button className="px-6 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-light transition-colors">
                    {t("settings.save") || t("common.save")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <LocaleProvider>
      <DashboardContent />
    </LocaleProvider>
  );
}
