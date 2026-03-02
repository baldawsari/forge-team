"use client";

import React, { useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Clock, User, FileText, MessageSquare, Plus, Play, Check, RotateCcw, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn, formatTimeElapsed } from "@/lib/utils";
import type { Task, Agent, Message } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  messages?: Message[];
  onTaskMove: (taskId: string, newColumn: Task["status"]) => void;
  onTaskCreate?: (task: { title: string; description: string; priority: string; assignedTo?: string }) => void;
  onTaskStart?: (taskId: string) => void;
  onTaskApprove?: (taskId: string) => void;
  onTaskReject?: (taskId: string, feedback: string) => void;
  processingTasks?: Set<string>;
  onSwitchToConversation?: (agentId: string) => void;
}

const columns: { id: Task["status"]; enLabel: string; arLabel: string }[] = [
  { id: "backlog", enLabel: "Backlog", arLabel: "تراكم" },
  { id: "todo", enLabel: "To Do", arLabel: "للتنفيذ" },
  { id: "in-progress", enLabel: "In Progress", arLabel: "قيد التنفيذ" },
  { id: "review", enLabel: "Review", arLabel: "مراجعة" },
  { id: "done", enLabel: "Done", arLabel: "مكتمل" },
  { id: "cancelled", enLabel: "Cancelled", arLabel: "ملغي" },
];

const priorityLabels: Record<string, { en: string; ar: string }> = {
  critical: { en: "Critical", ar: "حرج" },
  high: { en: "High", ar: "عالي" },
  medium: { en: "Medium", ar: "متوسط" },
  low: { en: "Low", ar: "منخفض" },
};

function getColumnColor(id: string): string {
  switch (id) {
    case "backlog":
      return "#6c6c80";
    case "todo":
      return "#3b82f6";
    case "in-progress":
      return "#f59e0b";
    case "review":
      return "#8b5cf6";
    case "done":
      return "#28a745";
    case "cancelled":
      return "#dc3545";
    default:
      return "#6c6c80";
  }
}

interface TaskCardExpandedProps {
  task: Task;
  agent: Agent | undefined;
  locale: string;
  messages?: Message[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToConversation?: (agentId: string) => void;
}

function TaskCardExpanded({ task, agent, locale, messages, open, onOpenChange, onSwitchToConversation }: TaskCardExpandedProps) {
  const isAr = locale === "ar";
  const { t } = useLocale();

  const agentMessages = (messages ?? [])
    .filter((m) => agent && m.from === agent.name)
    .slice(-3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-text-primary pe-8 bidi-auto">
            {isAr ? task.titleAr : task.title}
          </DialogTitle>
        </DialogHeader>

        {(task as any).waitingForHuman && (
          <Badge className="w-fit bg-amber-500/20 text-amber-500 border-amber-500/30">
            {t("kanban.waitingForHuman")}
          </Badge>
        )}

        <Badge className={cn("w-fit", `priority-${task.priority}`)} variant="outline">
          {isAr ? priorityLabels[task.priority].ar : priorityLabels[task.priority].en}
        </Badge>

        <p className="text-text-secondary text-sm bidi-auto">
          {isAr ? task.descriptionAr : task.description}
        </p>

        {agent && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-light/50">
            <span className="text-2xl">{agent.avatar}</span>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {isAr ? agent.nameAr : agent.name}
              </p>
              <p className="text-xs text-text-secondary">
                {isAr ? agent.roleAr : agent.role}
              </p>
            </div>
          </div>
        )}

        {agent && onSwitchToConversation && (
          <Button
            variant="outline"
            onClick={() => { onSwitchToConversation(agent.id); onOpenChange(false); }}
            className="w-full bg-primary/15 text-primary-light text-xs font-medium hover:bg-primary/25 border-primary/20"
          >
            <MessageSquare size={12} />
            {isAr ? "عرض في المحادثة" : "View in Conversation"}
          </Button>
        )}

        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1 ltr-nums">
            <Clock size={14} />
            {formatTimeElapsed(task.startedAt ?? "", locale)}
          </span>
        </div>

        {/* Agent Response section */}
        {task.agentResponse && (
          <div className="border-t border-border/40 pt-4">
            <h4 className="text-sm font-semibold text-text-secondary mb-2 flex items-center gap-2">
              <MessageSquare size={14} />
              {isAr ? "رد الوكيل" : "Agent Response"}
            </h4>
            <div className="max-h-72 overflow-y-auto rounded-lg bg-surface-light/30 p-3">
              <pre className="text-xs text-text-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">
                {task.agentResponse}
              </pre>
            </div>
          </div>
        )}

        {/* Artifacts section */}
        <div className="border-t border-border/40 pt-4">
          <h4 className="text-sm font-semibold text-text-secondary mb-2 flex items-center gap-2">
            <FileText size={14} />
            {t("kanban.artifacts")}
          </h4>
          <div className="space-y-2">
            {task.artifacts && task.artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {task.artifacts.map((artifact, i) => {
                  const isPath = artifact.startsWith('/api/');
                  const href = isPath ? `http://localhost:18789${artifact}` : artifact;
                  const displayName = isPath
                    ? decodeURIComponent(artifact.split('/').pop()?.replace(/\?.*/, '') || artifact)
                    : artifact;
                  return (
                    <a
                      key={i}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary-light border border-primary/25 hover:bg-primary/25 transition-colors cursor-pointer"
                    >
                      <FileText size={10} />
                      {displayName}
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-text-muted p-2 rounded bg-surface-light/30">
                {t("kanban.noArtifacts")}
              </div>
            )}
          </div>
        </div>

        {/* Agent messages */}
        <div className="border-t border-border/40 pt-4">
          <h4 className="text-sm font-semibold text-text-secondary mb-2 flex items-center gap-2">
            <MessageSquare size={14} />
            {t("kanban.agentMessages")}
          </h4>
          <div className="space-y-2">
            {agentMessages.length > 0 ? (
              agentMessages.map((msg) => (
                <div key={msg.id} className="text-xs text-text-secondary p-2 rounded bg-surface-light/30 bidi-auto">
                  <span className="font-medium text-text-primary">{msg.from}:</span>{" "}
                  {isAr && msg.contentAr ? msg.contentAr : msg.content}
                </div>
              ))
            ) : (
              <div className="text-xs text-text-muted p-2 rounded bg-surface-light/30 bidi-auto">
                {t("kanban.noMessages")}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function KanbanBoard({ tasks, agents, messages, onTaskMove, onTaskCreate, onTaskStart, onTaskApprove, onTaskReject, processingTasks, onSwitchToConversation }: KanbanBoardProps) {
  const { locale, t, direction } = useLocale();
  const isAr = locale === "ar";
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", priority: "medium", assignedTo: "" });
  const [feedbackTaskId, setFeedbackTaskId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const newColumn = result.destination.droppableId as Task["status"];
    onTaskMove(taskId, newColumn);
  };

  const getAgentForTask = (agentId: string | null) => {
    if (!agentId) return undefined;
    return agents.find((a) => a.id === agentId);
  };

  const expandedTaskData = expandedTask ? tasks.find((t) => t.id === expandedTask) : null;

  const orderedColumns = direction === "rtl" ? [...columns].reverse() : columns;

  const handleCreate = () => {
    if (!newTask.title.trim()) return;
    onTaskCreate?.({
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      assignedTo: newTask.assignedTo || undefined,
    });
    setNewTask({ title: "", description: "", priority: "medium", assignedTo: "" });
    setShowCreateForm(false);
  };

  return (
    <>
      {/* Add Task button */}
      <div className="flex justify-end mb-3">
        <Button
          onClick={() => setShowCreateForm(true)}
          className="rounded-xl bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/25"
        >
          <Plus size={16} />
          {isAr ? "مهمة جديدة" : "New Task"}
        </Button>
      </div>

      {/* Create Task Modal */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent className="glass-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-text-primary">{t("kanban.createTask")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input
              dir="auto"
              placeholder={isAr ? "عنوان المهمة..." : "Task title..."}
              value={newTask.title}
              onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-light/30 border border-border/40 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <textarea
              dir="auto"
              placeholder={isAr ? "الوصف (اختياري)..." : "Description (optional)..."}
              value={newTask.description}
              onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface-light/30 border border-border/40 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <div className="flex gap-3">
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask((p) => ({ ...p, priority: e.target.value }))}
                className="flex-1 px-3 py-2 rounded-lg bg-surface-light/30 border border-border/40 text-text-primary text-sm focus:outline-none"
              >
                <option value="low">{isAr ? "منخفض" : "Low"}</option>
                <option value="medium">{isAr ? "متوسط" : "Medium"}</option>
                <option value="high">{isAr ? "عالي" : "High"}</option>
                <option value="critical">{isAr ? "حرج" : "Critical"}</option>
              </select>
              <select
                value={newTask.assignedTo}
                onChange={(e) => setNewTask((p) => ({ ...p, assignedTo: e.target.value }))}
                className="flex-1 px-3 py-2 rounded-lg bg-surface-light/30 border border-border/40 text-text-primary text-sm focus:outline-none"
              >
                <option value="">{t("kanban.unassigned")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{isAr ? a.nameAr : a.name}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleCreate}
              disabled={!newTask.title.trim()}
              className="w-full bg-primary text-white hover:bg-primary/90"
            >
              {t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ direction: "ltr" }}>
          {orderedColumns.map((column) => {
            const columnTasks = tasks.filter((t) => t.status === column.id);
            const color = getColumnColor(column.id);

            return (
              <div key={column.id} className="kanban-column flex-1 min-w-[220px] p-3">
                {/* Column header */}
                <div className="flex items-center justify-between mb-4 px-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <h3 className="text-sm font-semibold text-text-primary" dir={direction}>
                      {isAr ? column.arLabel : column.enLabel}
                    </h3>
                  </div>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full ltr-nums"
                    style={{
                      backgroundColor: `${color}20`,
                      color,
                    }}
                  >
                    {columnTasks.length}
                  </span>
                </div>

                {/* Droppable area */}
                <Droppable droppableId={column.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "min-h-[200px] rounded-lg p-1 transition-colors",
                        snapshot.isDraggingOver && "bg-primary/10"
                      )}
                    >
                      {columnTasks.map((task, index) => {
                        const agent = getAgentForTask(task.assignedTo);
                        return (
                          <Draggable
                            key={task.id}
                            draggableId={task.id}
                            index={index}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={cn(
                                  "kanban-card",
                                  snapshot.isDragging && "dragging"
                                )}
                                onClick={() => setExpandedTask(task.id)}
                                dir={direction}
                              >
                                {/* Waiting for human badge */}
                                {(task as any).waitingForHuman && (
                                  <div className="mb-1.5">
                                    <Badge className="text-[9px] bg-amber-500/20 text-amber-500 border-amber-500/30">
                                      {t("kanban.waitingForHuman")}
                                    </Badge>
                                  </div>
                                )}

                                {/* Priority badge */}
                                <div className="flex items-center justify-between mb-2">
                                  <Badge
                                    variant={task.priority === "critical" ? "destructive" : "outline"}
                                    className={cn(`priority-${task.priority}`)}
                                  >
                                    {isAr
                                      ? priorityLabels[task.priority].ar
                                      : priorityLabels[task.priority].en}
                                  </Badge>
                                </div>

                                {/* Title */}
                                <h4 className="text-sm font-medium text-text-primary mb-2 bidi-auto leading-relaxed">
                                  {isAr ? task.titleAr : task.title}
                                </h4>

                                {/* Agent + time */}
                                <div className="flex items-center justify-between text-xs text-text-muted mt-2 pt-2 border-t border-border/20">
                                  {agent ? (
                                    <div className="flex items-center gap-1.5">
                                      <span>{agent.avatar}</span>
                                      <span className="truncate max-w-[100px]">
                                        {isAr ? agent.nameAr : agent.name}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 text-text-muted/50">
                                      <User size={12} />
                                      <span>{t("kanban.unassigned")}</span>
                                    </div>
                                  )}
                                  <span className="flex items-center gap-1 ltr-nums">
                                    <Clock size={12} />
                                    {formatTimeElapsed(task.startedAt ?? "", locale)}
                                  </span>
                                </div>

                                {/* Action buttons */}
                                <div className="mt-2 pt-2 border-t border-border/20" onClick={(e) => e.stopPropagation()}>
                                  {(task.status === "backlog" || task.status === "todo") && onTaskStart && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); onTaskStart(task.id); }}
                                      disabled={processingTasks?.has(task.id)}
                                      className={cn(
                                        "w-full h-auto py-1.5 text-[11px] font-medium",
                                        processingTasks?.has(task.id)
                                          ? "bg-green-500/10 text-green-400/50 cursor-wait"
                                          : "bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20"
                                      )}
                                    >
                                      {processingTasks?.has(task.id) ? (
                                        <><Loader2 size={12} className="animate-spin" />{isAr ? "يعمل..." : "Working..."}</>
                                      ) : (
                                        <><Play size={12} />{t("kanban.start") || (isAr ? "ابدأ" : "Start")}</>
                                      )}
                                    </Button>
                                  )}

                                  {task.status === "in-progress" && (
                                    <div className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-amber-400">
                                      <Loader2 size={12} className="animate-spin" />
                                      <span>{t("kanban.working") || (isAr ? "يعمل..." : "Working...")}</span>
                                    </div>
                                  )}

                                  {task.status === "review" && (
                                    <div className="flex gap-2">
                                      {onTaskApprove && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => { e.stopPropagation(); onTaskApprove(task.id); }}
                                          disabled={processingTasks?.has(task.id)}
                                          className="flex-1 h-auto py-1.5 text-[11px] font-medium bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20"
                                        >
                                          <Check size={12} />
                                          {t("kanban.approve") || (isAr ? "موافقة" : "Approve")}
                                        </Button>
                                      )}
                                      {onTaskReject && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => { e.stopPropagation(); setFeedbackTaskId(task.id); }}
                                          disabled={processingTasks?.has(task.id)}
                                          className="flex-1 h-auto py-1.5 text-[11px] font-medium bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20"
                                        >
                                          <RotateCcw size={12} />
                                          {t("kanban.revise") || (isAr ? "مراجعة" : "Revise")}
                                        </Button>
                                      )}
                                    </div>
                                  )}

                                  {task.status === "done" && (
                                    <div className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-green-400/60">
                                      <Check size={12} />
                                      <span>{isAr ? "مكتمل" : "Done"}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                      {columnTasks.length === 0 && (
                        <div className="text-center text-text-muted/40 text-xs py-8">
                          {t("kanban.noTasks")}
                        </div>
                      )}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      {/* Expanded task modal */}
      {expandedTaskData && (
        <TaskCardExpanded
          task={expandedTaskData}
          agent={getAgentForTask(expandedTaskData.assignedTo)}
          locale={locale}
          messages={messages}
          open={!!expandedTask}
          onOpenChange={(open) => { if (!open) setExpandedTask(null); }}
          onSwitchToConversation={onSwitchToConversation}
        />
      )}

      {/* Feedback modal for task revision */}
      <Dialog open={!!feedbackTaskId} onOpenChange={(open) => { if (!open) { setFeedbackTaskId(null); setFeedbackText(""); } }}>
        <DialogContent className="glass-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-text-primary">
              {t("kanban.revisionFeedback")}
            </DialogTitle>
          </DialogHeader>
          <textarea
            dir="auto"
            placeholder={t("kanban.feedbackPlaceholder") || (isAr ? "أدخل ملاحظات المراجعة..." : "Enter revision feedback...")}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-surface-light/30 border border-border/40 text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { setFeedbackTaskId(null); setFeedbackText(""); }}
              className="flex-1 bg-surface-light/30 text-text-secondary hover:bg-surface-light/50"
            >
              {t("common.cancel") || (isAr ? "إلغاء" : "Cancel")}
            </Button>
            <Button
              onClick={() => {
                if (feedbackText.trim() && onTaskReject && feedbackTaskId) {
                  onTaskReject(feedbackTaskId, feedbackText.trim());
                }
                setFeedbackTaskId(null);
                setFeedbackText("");
              }}
              disabled={!feedbackText.trim()}
              className="flex-1 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            >
              {t("kanban.revise") || (isAr ? "مراجعة" : "Send Feedback")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
