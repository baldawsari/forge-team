"use client";

import React, { useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";
import { Clock, User, X, FileText, MessageSquare } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn, formatTimeElapsed } from "@/lib/utils";
import type { Task, Agent, Message } from "@/lib/mock-data";

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  messages?: Message[];
  onTaskMove: (taskId: string, newColumn: Task["column"]) => void;
}

const columns: { id: Task["column"]; enLabel: string; arLabel: string }[] = [
  { id: "backlog", enLabel: "Backlog", arLabel: "تراكم" },
  { id: "todo", enLabel: "To Do", arLabel: "للتنفيذ" },
  { id: "inProgress", enLabel: "In Progress", arLabel: "قيد التنفيذ" },
  { id: "review", enLabel: "Review", arLabel: "مراجعة" },
  { id: "done", enLabel: "Done", arLabel: "مكتمل" },
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
    case "inProgress":
      return "#f59e0b";
    case "review":
      return "#8b5cf6";
    case "done":
      return "#28a745";
    default:
      return "#6c6c80";
  }
}

interface TaskCardExpandedProps {
  task: Task;
  agent: Agent | undefined;
  locale: string;
  messages?: Message[];
  onClose: () => void;
}

function TaskCardExpanded({ task, agent, locale, messages, onClose }: TaskCardExpandedProps) {
  const isAr = locale === "ar";
  const { t } = useLocale();

  const agentMessages = (messages ?? [])
    .filter((m) => agent && m.from === agent.name)
    .slice(-3);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-lg p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 end-4 text-text-secondary hover:text-text-primary transition-colors"
        >
          <X size={20} />
        </button>

        <h3 className="text-lg font-bold text-text-primary mb-1 pe-8 bidi-auto">
          {isAr ? task.titleAr : task.title}
        </h3>

        {(task as any).waitingForHuman && (
          <span className="inline-block mb-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500">
            {t("kanban.waitingForHuman")}
          </span>
        )}

        <span className={cn("priority-badge mb-4 inline-block", `priority-${task.priority}`)}>
          {isAr ? priorityLabels[task.priority].ar : priorityLabels[task.priority].en}
        </span>

        <p className="text-text-secondary text-sm mb-4 bidi-auto">
          {isAr ? task.descriptionAr : task.description}
        </p>

        {agent && (
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-surface-light/50">
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

        <div className="flex items-center gap-4 text-xs text-text-muted mb-4">
          <span className="flex items-center gap-1 ltr-nums">
            <Clock size={14} />
            {formatTimeElapsed(task.startTime, locale)}
          </span>
        </div>

        {/* Artifacts section */}
        <div className="border-t border-border/40 pt-4">
          <h4 className="text-sm font-semibold text-text-secondary mb-2 flex items-center gap-2">
            <FileText size={14} />
            {t("kanban.artifacts")}
          </h4>
          <div className="space-y-2">
            {task.artifacts && task.artifacts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {task.artifacts.map((artifact, i) => (
                  <a
                    key={i}
                    href={artifact}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary-light border border-primary/25 hover:bg-primary/25 transition-colors cursor-pointer"
                  >
                    <FileText size={10} />
                    {artifact}
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-xs text-text-muted p-2 rounded bg-surface-light/30">
                {t("kanban.noArtifacts")}
              </div>
            )}
          </div>
        </div>

        {/* Agent messages */}
        <div className="border-t border-border/40 pt-4 mt-4">
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
      </div>
    </div>
  );
}

export default function KanbanBoard({ tasks, agents, messages, onTaskMove }: KanbanBoardProps) {
  const { locale, t, direction } = useLocale();
  const isAr = locale === "ar";
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const newColumn = result.destination.droppableId as Task["column"];
    onTaskMove(taskId, newColumn);
  };

  const getAgentForTask = (agentId: string | null) => {
    if (!agentId) return undefined;
    return agents.find((a) => a.id === agentId);
  };

  const expandedTaskData = expandedTask ? tasks.find((t) => t.id === expandedTask) : null;

  const orderedColumns = direction === "rtl" ? [...columns].reverse() : columns;

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ direction: "ltr" }}>
          {orderedColumns.map((column) => {
            const columnTasks = tasks.filter((t) => t.column === column.id);
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
                        const agent = getAgentForTask(task.assignedAgent);
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
                                    <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500">
                                      {t("kanban.waitingForHuman")}
                                    </span>
                                  </div>
                                )}

                                {/* Priority badge */}
                                <div className="flex items-center justify-between mb-2">
                                  <span
                                    className={cn(
                                      "priority-badge",
                                      `priority-${task.priority}`
                                    )}
                                  >
                                    {isAr
                                      ? priorityLabels[task.priority].ar
                                      : priorityLabels[task.priority].en}
                                  </span>
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
                                    {formatTimeElapsed(task.startTime, locale)}
                                  </span>
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
          agent={getAgentForTask(expandedTaskData.assignedAgent)}
          locale={locale}
          messages={messages}
          onClose={() => setExpandedTask(null)}
        />
      )}
    </>
  );
}
