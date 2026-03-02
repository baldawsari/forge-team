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
  createTask,
  startTask,
  approveTask,
  rejectTask,
  fetchEscalations,
  pauseAllWorkflows,
  resumeAllWorkflows,
  takeOverAgent,
  releaseAgent,
  sendHumanMessage,
  type GatewayAgent,
  type ModelAssignment,
  type Escalation,
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
import InterruptModal from "@/components/InterruptModal";
import EscalationQueue from "@/components/EscalationQueue";
import TakeOverBanner from "@/components/TakeOverBanner";
import { Button } from "@/components/ui/button";

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
    nameAr: "جون (مدير المنتج)",
    role: "Requirements & Prioritization",
    roleAr: "المتطلبات والأولويات",
    avatar: "\uD83D\uDCCB",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "business-analyst": {
    nameAr: "ماري (محللة الأعمال)",
    role: "Research & Analysis",
    roleAr: "البحث والتحليل",
    avatar: "\uD83D\uDCCA",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "scrum-master": {
    nameAr: "بوب (سكرم ماستر)",
    role: "Agile Coordination",
    roleAr: "التنسيق الرشيق",
    avatar: "\u26A1",
    defaultModel: "gemini-flash-3",
    defaultFallback: "claude-haiku-4-5",
  },
  architect: {
    nameAr: "ونستون (المعماري)",
    role: "System Design",
    roleAr: "تصميم النظام",
    avatar: "\uD83C\uDFD7\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "gemini-3.1-pro",
  },
  "ux-designer": {
    nameAr: "سالي (مصممة UX)",
    role: "User Experience",
    roleAr: "تجربة المستخدم",
    avatar: "\uD83C\uDFA8",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "frontend-dev": {
    nameAr: "أميليا-FE (مطورة)",
    role: "Frontend Code",
    roleAr: "كود الواجهة",
    avatar: "\uD83D\uDCBB",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "backend-dev": {
    nameAr: "أميليا-BE (مطورة)",
    role: "Backend & APIs",
    roleAr: "الخلفية والـ APIs",
    avatar: "\u2699\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "claude-sonnet-4-6",
  },
  "qa-architect": {
    nameAr: "كوين (مهندسة جودة)",
    role: "Testing & QA",
    roleAr: "الاختبار والجودة",
    avatar: "\uD83D\uDD0D",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "claude-sonnet-4-6",
  },
  "devops-engineer": {
    nameAr: "باري (DevOps)",
    role: "CI/CD & Infrastructure",
    roleAr: "البنية التحتية",
    avatar: "\uD83D\uDE80",
    defaultModel: "gemini-3.1-pro",
    defaultFallback: "claude-sonnet-4-6",
  },
  "security-specialist": {
    nameAr: "شيلد (الأمن)",
    role: "Security & Compliance",
    roleAr: "الأمن والامتثال",
    avatar: "\uD83D\uDEE1\uFE0F",
    defaultModel: "claude-opus-4-6",
    defaultFallback: "gemini-3.1-pro",
  },
  "tech-writer": {
    nameAr: "بايج (التوثيق)",
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
  costByAgent: Record<string, number>
): Agent {
  const meta = AGENT_META[gw.id];
  const assignment = assignments[gw.id];
  const agentCost = costByAgent[gw.id] ?? 0;

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
    currentTaskId: gw.currentTaskId,
    currentTaskIdAr: gw.currentTaskId,
    model: assignment?.primary ?? meta?.defaultModel ?? "gemini-3.1-pro",
    fallbackModel: assignment?.fallback ?? meta?.defaultFallback ?? "claude-sonnet-4-6",
    temperature: 0.3,
    tokensUsed: 0,
    cost: agentCost,
  };
}

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
  const validPriorities = ["critical", "high", "medium", "low"];
  const priority = (validPriorities.includes(gw.priority) ? gw.priority : "medium") as Task["priority"];

  return {
    id: gw.id,
    title: gw.title,
    titleAr: gw.title,
    description: gw.description,
    descriptionAr: gw.description,
    status: (gw.status || "backlog") as Task["status"],
    assignedTo: gw.assignedTo,
    priority,
    startedAt: gw.createdAt || null,
    artifacts: gw.artifacts,
    agentResponse: (gw.metadata?.agentResponse as string) || undefined,
  };
}

// Map gateway VIADP delegations to the dashboard DelegationEntry interface
function mapGatewayDelegation(gw: {
  id: string;
  from: string;
  to: string;
  taskId: string;
  status: string;
  reason?: string;
  capabilityScore?: number;
  createdAt?: string;
  timestamp?: string;
}): DelegationEntry {
  const validStatuses = ["verified", "pending", "failed"];
  const mappedStatus = gw.status === 'approved' || gw.status === 'completed' ? 'verified'
    : gw.status === 'rejected' ? 'failed'
    : validStatuses.includes(gw.status) ? gw.status : 'pending';

  return {
    id: gw.id,
    from: gw.from,
    to: gw.to,
    taskId: gw.taskId,
    taskAr: gw.taskId,
    trustScore: gw.capabilityScore ?? 0,
    status: mappedStatus as DelegationEntry["status"],
    timestamp: gw.createdAt ?? gw.timestamp ?? new Date().toISOString(),
    proofChain: [],
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
  const [processingTasks, setProcessingTasks] = useState<Set<string>>(new Set());
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [takenOverAgent, setTakenOverAgent] = useState<string | null>(null);

  // Cache model assignments and cost data for mapping
  const assignmentsRef = useRef<Record<string, ModelAssignment>>({});
  const costByAgentRef = useRef<Record<string, number>>({});

  // Fetch all data from gateway
  const loadData = useCallback(async () => {
    try {
      // Fetch agents, tasks, models, costs, and delegations in parallel
      // Each call is individually wrapped to prevent Chrome extensions from
      // breaking the Promise.allSettled flow with unhandled rejections.
      const safe = <T,>(p: Promise<T>) => p.catch((err: unknown) => {
        console.warn("[loadData]", err instanceof Error ? err.message : err);
        return undefined as unknown as T;
      });
      const results = await Promise.allSettled([
        safe(apiFetchAgents()),
        safe(apiFetchTasks()),
        safe(fetchModelAssignments()),
        safe(fetchModelCosts()),
        safe(fetchViadpDelegations()),
      ]);

      // Unwrap results (safe() makes them all "fulfilled", but value may be undefined on failure)
      const agentsRes = results[0].status === "fulfilled" ? results[0].value : undefined;
      const tasksRes = results[1].status === "fulfilled" ? results[1].value : undefined;
      const assignRes = results[2].status === "fulfilled" ? results[2].value : undefined;
      const costsRes = results[3].status === "fulfilled" ? results[3].value : undefined;
      const delegRes = results[4].status === "fulfilled" ? results[4].value : undefined;

      // Process model assignments
      if (assignRes?.assignments) {
        assignmentsRef.current = assignRes.assignments;
      }

      // Process cost data
      if (costsRes?.summary) {
        costByAgentRef.current = costsRes.summary.perAgent ?? {};
        setTodayCost(costsRes.summary.totalCost ?? 0);
      }

      // Process agents - fall back to mockAgents on failure or empty
      if (agentsRes?.agents?.length) {
        const mapped = agentsRes.agents.map((gw) =>
          mapGatewayAgent(gw, assignmentsRef.current, costByAgentRef.current)
        );
        setAgents(mapped);
      } else {
        setAgents((prev) => (prev.length === 0 ? mockAgents : prev));
      }

      // Process tasks - fall back to mockTasks on failure or empty
      if (tasksRes?.tasks?.length) {
        const mapped = tasksRes.tasks.map(mapGatewayTask);
        setTasks(mapped);
      } else {
        setTasks((prev) => (prev.length === 0 ? mockTasks : prev));
      }

      // Process delegations
      if (delegRes?.delegations) {
        const mapped = delegRes.delegations.map(mapGatewayDelegation);
        setDelegations(mapped);
      }

      // Fetch escalations
      const escalRes = await fetchEscalations().catch(() => ({ escalations: [] }));
      setEscalations(escalRes.escalations);
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
                currentTaskId: data.currentTask !== undefined ? data.currentTask : a.currentTaskId,
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

      // Clear processing state for this task
      setProcessingTasks(prev => {
        if (prev.has(evt.taskId)) {
          const s = new Set(prev);
          s.delete(evt.taskId);
          return s;
        }
        return prev;
      });

      setTasks((prev) => {
        const exists = prev.some((t) => t.id === evt.taskId);
        if (!exists && data.type === "created") {
          // Append newly created tasks
          const status = (evt.currentStatus || "backlog") as Task["status"];
          return [
            ...prev,
            {
              id: evt.taskId,
              title: evt.data?.title ?? "Untitled",
              titleAr: evt.data?.title ?? "Untitled",
              description: "",
              descriptionAr: "",
              status,
              assignedTo: evt.data?.assignedTo ?? null,
              priority: (evt.data?.priority || "medium") as Task["priority"],
              startedAt: evt.timestamp,
            },
          ];
        }
        // Update existing tasks
        return prev.map((t) => {
          if (t.id !== evt.taskId) return t;
          const status = (evt.currentStatus || "backlog") as Task["status"];
          return {
            ...t,
            status,
            title: evt.data?.title ?? t.title,
            assignedTo: evt.data?.assignedTo ?? t.assignedTo,
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

    // Workflow updates — gateway sends { type, instanceId, phaseName, ... }
    const unsubWorkflow = on("workflow_update", (data) => {
      if (!data) return;
      if (data.type === 'phase_changed' && data.phaseName) {
        setWorkflowPhases((prev) =>
          prev.map((p) =>
            p.name === data.phaseName
              ? { ...p, status: "active" as WorkflowPhase["status"] }
              : p.status === "active"
                ? { ...p, status: "completed" as WorkflowPhase["status"], progress: 100 }
                : p
          )
        );
      } else if (data.type === 'completed') {
        setWorkflowPhases((prev) =>
          prev.map((p) => ({ ...p, status: "completed" as WorkflowPhase["status"], progress: 100 }))
        );
      } else if (data.type === 'step_completed' && data.phaseName) {
        setWorkflowPhases((prev) =>
          prev.map((p) =>
            p.name === data.phaseName
              ? { ...p, checkpointsComplete: Math.min(p.checkpointsComplete + 1, p.checkpoints), progress: Math.min(100, p.progress + Math.round(100 / Math.max(p.checkpoints, 1))) }
              : p
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

    // Real-time cost updates — gateway sends { type, agentId, dailyUsed, dailyCap }
    const unsubCost = on("cost_update", (data) => {
      if (data && typeof data.dailyUsed === "number") {
        setTodayCost(data.dailyUsed);
      }
    });

    // Escalation updates
    const unsubEscalation = on('escalation_update', (data) => {
      if (data.type === 'created' && data.escalation) {
        setEscalations(prev => [...prev, data.escalation as Escalation]);
      } else {
        fetchEscalations().then(r => setEscalations(r.escalations)).catch(() => {});
      }
    });

    // Initial state snapshot from gateway — populate data immediately
    const unsubInitialState = on('initial_state', (data) => {
      if (data.agents?.length) {
        const mapped = data.agents.map((gw) =>
          mapGatewayAgent(gw as GatewayAgent, assignmentsRef.current, costByAgentRef.current)
        );
        setAgents(mapped);
      }
      if (data.tasks?.length) {
        const mapped = (data.tasks as any[]).map(mapGatewayTask);
        setTasks(mapped);
      }
      setIsLoading(false);
    });

    // Workflow approval gates — surface to user via interrupt-like behavior
    const unsubApproval = on('approval_requested', (data) => {
      console.log('[Socket] Workflow approval requested:', data.instanceId);
      // Trigger a data reload to pick up the new interrupt
      loadData();
    });

    // Workflow progress updates
    const unsubProgress = on('workflow_progress', (data) => {
      if (data.instanceId && data.progress != null) {
        console.log('[Socket] Workflow progress:', data.instanceId, data.progress);
      }
    });

    return () => {
      unsubStatus();
      unsubTask();
      unsubMessage();
      unsubWorkflow();
      unsubSession();
      unsubViadp();
      unsubCost();
      unsubEscalation();
      unsubInitialState();
      unsubApproval();
      unsubProgress();
    };
  }, [on, loadData]);

  const handleTaskMove = useCallback((taskId: string, newColumn: Task["status"]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newColumn } : t))
    );
    // Persist the move to the gateway
    updateTask(taskId, { status: newColumn }).catch((err) => {
      console.error("Failed to update task on gateway:", err);
    });
  }, []);

  const handleTaskCreate = useCallback((task: { title: string; description: string; priority: string; assignedTo?: string }) => {
    // Optimistically add to local state
    const tempId = `temp-${Date.now()}`;
    setTasks((prev) => [
      ...prev,
      {
        id: tempId,
        title: task.title,
        titleAr: task.title,
        description: task.description,
        descriptionAr: task.description,
        status: "backlog" as Task["status"],
        assignedTo: task.assignedTo ?? null,
        priority: task.priority as Task["priority"],
        startedAt: null,
      },
    ]);
    // Send to gateway
    createTask({
      sessionId: "default",
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignedTo: task.assignedTo,
    }).catch((err) => console.error("Failed to create task:", err));
  }, []);

  const handleTaskStart = useCallback(async (taskId: string) => {
    setProcessingTasks(prev => new Set(prev).add(taskId));
    try {
      const result = await startTask(taskId);
      // Store the agent response on the task so the expanded card can show it
      if (result?.response) {
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, agentResponse: result.response } : t
        ));
      }
    } catch (err) {
      console.error("Failed to start task:", err);
    } finally {
      setProcessingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  }, []);

  const handleTaskApprove = useCallback(async (taskId: string) => {
    setProcessingTasks(prev => new Set(prev).add(taskId));
    try {
      await approveTask(taskId);
    } catch (err) {
      console.error("Failed to approve task:", err);
    } finally {
      setProcessingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  }, []);

  const handleTaskReject = useCallback(async (taskId: string, feedback: string) => {
    setProcessingTasks(prev => new Set(prev).add(taskId));
    try {
      await rejectTask(taskId, feedback);
    } catch (err) {
      console.error("Failed to reject task:", err);
    } finally {
      setProcessingTasks(prev => { const s = new Set(prev); s.delete(taskId); return s; });
    }
  }, []);

  const handleSwitchToConversation = useCallback((agentId: string) => {
    setActiveTab("conversation");
  }, []);

  const handleTakeOver = useCallback(async (agentId: string) => {
    try {
      await takeOverAgent(agentId);
      setTakenOverAgent(agentId);
    } catch (err) {
      console.error("Failed to take over agent:", err);
    }
  }, []);

  const handleRelease = useCallback(async () => {
    if (!takenOverAgent) return;
    try {
      await releaseAgent(takenOverAgent);
      setTakenOverAgent(null);
    } catch (err) {
      console.error("Failed to release agent:", err);
    }
  }, [takenOverAgent]);

  const handleTakeOverMessage = useCallback(async (content: string) => {
    if (!takenOverAgent) return;
    try {
      await sendHumanMessage(takenOverAgent, content);
    } catch (err) {
      console.error("Failed to send human message:", err);
    }
  }, [takenOverAgent]);

  // Computed stats
  const activeTasks = tasks.filter(
    (t) => t.status === "in-progress" || t.status === "review"
  ).length;
  const workingAgents = agents.filter(
    (a) => a.status === "working" || a.status === "reviewing"
  ).length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
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
    conversation: t("nav.conversation"),
    kanban: t("nav.kanban"),
    agents: t("nav.agents"),
    workflows: t("nav.workflows"),
    memory: t("nav.memory"),
    modelsCost: t("nav.modelsCost"),
    viadpAudit: t("nav.viadpAudit"),
    escalations: t("nav.escalations"),
    settings: t("nav.settings"),
    "voice-transcripts": t("nav.voiceTranscripts"),
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
                  {t("common.loading")}
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
        <InterruptModal agents={agents} />

        <div className="p-6 space-y-6">
          {takenOverAgent && (() => {
            const agent = agents.find(a => a.id === takenOverAgent);
            if (!agent) return null;
            return (
              <TakeOverBanner
                agentId={agent.id}
                agentName={agent.name}
                agentNameAr={agent.nameAr}
                agentAvatar={agent.avatar}
                onRelease={handleRelease}
                onSendMessage={handleTakeOverMessage}
              />
            );
          })()}

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
                  ? t("common.connected")
                  : t("common.offline")}
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
                    onTaskCreate={handleTaskCreate}
                    onTaskStart={handleTaskStart}
                    onTaskApprove={handleTaskApprove}
                    onTaskReject={handleTaskReject}
                    processingTasks={processingTasks}
                    onSwitchToConversation={handleSwitchToConversation}
                  />
                </div>

                {/* Agent status grid - right sidebar */}
                <div className="lg:col-span-1">
                  <AgentStatusGrid
                    agents={agents}
                    escalations={escalations}
                    takenOverAgents={takenOverAgent ? [takenOverAgent] : []}
                    onTakeOver={handleTakeOver}
                    onRelease={handleRelease}
                  />
                </div>
              </div>

              {/* Bottom row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <MessageFeed messages={messages} />
                <WorkflowProgress
                  phases={workflowPhases}
                  onPauseAll={async () => {
                    try { await pauseAllWorkflows(); } catch (err) { console.error(err); }
                  }}
                  onResumeAll={async () => {
                    try { await resumeAllWorkflows(); } catch (err) { console.error(err); }
                  }}
                />
              </div>
            </>
          )}

          {/* Conversation view - kept mounted to preserve session state */}
          <div style={{ display: activeTab === "conversation" ? "block" : "none" }}>
            <ConversationPanel agents={agents} />
          </div>

          {/* Kanban full view */}
          {activeTab === "kanban" && (
            <KanbanBoard
              tasks={tasks}
              agents={agents}
              onTaskMove={handleTaskMove}
              onTaskCreate={handleTaskCreate}
              onTaskStart={handleTaskStart}
              onTaskApprove={handleTaskApprove}
              onTaskReject={handleTaskReject}
              processingTasks={processingTasks}
              onSwitchToConversation={handleSwitchToConversation}
            />
          )}

          {/* Agents full view */}
          {activeTab === "agents" && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {agents.length === 0 ? (
                <div className="col-span-full text-center text-text-muted/40 text-sm py-16">
                  {t("agents.noAgents")}
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
                      {agent.currentTaskId
                        ? locale === "ar"
                          ? agent.currentTaskIdAr
                          : agent.currentTaskId
                        : t("agents.noActiveTask")}
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
            <WorkflowProgress
              phases={workflowPhases}
              onPauseAll={async () => {
                try { await pauseAllWorkflows(); } catch (err) { console.error(err); }
              }}
              onResumeAll={async () => {
                try { await resumeAllWorkflows(); } catch (err) { console.error(err); }
              }}
            />
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

          {/* Escalations view */}
          {activeTab === "escalations" && (
            <EscalationQueue agents={agents} />
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
                    {t("settings.gatewayUrl")}
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
                    {t("settings.defaultModel")}
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
                    {t("settings.dailyBudgetLimit")}
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
                    {t("settings.autoScroll")}
                  </span>
                  <button className="w-12 h-6 rounded-full bg-primary relative transition-colors">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all" style={{ insetInlineEnd: "2px" }} />
                  </button>
                </div>

                {/* Notifications */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">
                    {t("settings.escalationNotifications")}
                  </span>
                  <button className="w-12 h-6 rounded-full bg-primary relative transition-colors">
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all" style={{ insetInlineEnd: "2px" }} />
                  </button>
                </div>

                {/* Save button */}
                <div className="pt-4 border-t border-border/30">
                  <Button className="bg-primary text-white hover:bg-primary-light">
                    {t("settings.save") || t("common.save")}
                  </Button>
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
