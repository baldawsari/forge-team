/**
 * ForgeTeam Inter-Agent Communication Module
 *
 * Provides the messaging backbone for agent-to-agent and agent-to-human
 * communication within the ForgeTeam autonomous SDLC system. Every message
 * is logged to an append-only audit trail for traceability and debugging.
 */

import { randomUUID } from "crypto";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAgent, getAllAgents, type AgentConfig } from "./index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType = "task" | "question" | "response" | "escalation";

export interface AgentMessage {
  /** Unique message identifier. */
  id: string;
  /** ID of the sending agent (or "@human"). */
  from: string;
  /** ID of the receiving agent, "@human", or "@team" for broadcasts. */
  to: string;
  /** The message body. */
  content: string;
  /** Classification of the message. */
  type: MessageType;
  /** ISO-8601 timestamp of when the message was created. */
  timestamp: string;
  /** Session ID grouping related messages into a conversation thread. */
  sessionId: string;
  /** Optional metadata for routing, threading, or context. */
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  /** Whether the message was accepted for delivery. */
  success: boolean;
  /** The created message object (for reference / chaining). */
  message: AgentMessage;
  /** Human-readable status note. */
  note?: string;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUMAN_ID = "@human";
const TEAM_ID = "@team";

const BASE_DIR =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

const AUDIT_DIR = join(BASE_DIR, "..", ".forge", "audit");
const AUDIT_FILE = join(AUDIT_DIR, "messages.jsonl");

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function logToAuditTrail(message: AgentMessage): void {
  ensureAuditDir();
  const line = JSON.stringify(message) + "\n";
  appendFileSync(AUDIT_FILE, line, "utf-8");
}

// ---------------------------------------------------------------------------
// In-process message bus (handler registry)
// ---------------------------------------------------------------------------

const handlers = new Map<string, MessageHandler[]>();

/**
 * Register a handler that will be invoked whenever a message is delivered
 * to the specified agent ID (or "@human" / "@team").
 */
export function onMessage(agentId: string, handler: MessageHandler): void {
  const existing = handlers.get(agentId) ?? [];
  existing.push(handler);
  handlers.set(agentId, existing);
}

/**
 * Remove all handlers for a given agent ID.
 */
export function offMessage(agentId: string): void {
  handlers.delete(agentId);
}

async function dispatch(message: AgentMessage): Promise<void> {
  const targetHandlers = handlers.get(message.to) ?? [];
  for (const handler of targetHandlers) {
    await handler(message);
  }

  // If the message is a broadcast, also dispatch to individual agent handlers.
  if (message.to === TEAM_ID) {
    for (const [agentId, agentHandlers] of handlers.entries()) {
      if (agentId === TEAM_ID || agentId === message.from) continue;
      for (const handler of agentHandlers) {
        await handler(message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Message factory
// ---------------------------------------------------------------------------

function createMessage(
  from: string,
  to: string,
  content: string,
  type: MessageType,
  sessionId?: string,
  metadata?: Record<string, unknown>
): AgentMessage {
  return {
    id: randomUUID(),
    from,
    to,
    content,
    type,
    timestamp: new Date().toISOString(),
    sessionId: sessionId ?? randomUUID(),
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidSender(id: string): boolean {
  return id === HUMAN_ID || getAgent(id) !== undefined;
}

function isValidRecipient(id: string): boolean {
  return id === HUMAN_ID || id === TEAM_ID || getAgent(id) !== undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a message from one agent to another.
 *
 * @param fromAgent  - The sending agent's ID (e.g. "bmad-master") or "@human".
 * @param toAgent    - The receiving agent's ID (e.g. "frontend-dev") or "@human".
 * @param content    - The message body text.
 * @param type       - Message classification: "task", "question", "response", or "escalation".
 * @param sessionId  - Optional session ID to group related messages. Auto-generated if omitted.
 * @param metadata   - Optional key-value metadata for routing or context.
 * @returns A SendResult indicating success and containing the created message.
 */
export async function sessions_send(
  fromAgent: string,
  toAgent: string,
  content: string,
  type: MessageType = "task",
  sessionId?: string,
  metadata?: Record<string, unknown>
): Promise<SendResult> {
  // Validate sender
  if (!isValidSender(fromAgent)) {
    const msg = createMessage(fromAgent, toAgent, content, type, sessionId, metadata);
    return {
      success: false,
      message: msg,
      note: `Unknown sender: "${fromAgent}". Must be a registered agent ID or "${HUMAN_ID}".`,
    };
  }

  // Validate recipient
  if (!isValidRecipient(toAgent)) {
    const msg = createMessage(fromAgent, toAgent, content, type, sessionId, metadata);
    return {
      success: false,
      message: msg,
      note: `Unknown recipient: "${toAgent}". Must be a registered agent ID, "${HUMAN_ID}", or "${TEAM_ID}".`,
    };
  }

  const message = createMessage(fromAgent, toAgent, content, type, sessionId, metadata);

  // Persist to audit trail
  logToAuditTrail(message);

  // Dispatch to in-process handlers
  await dispatch(message);

  return {
    success: true,
    message,
    note: `Message delivered from ${fromAgent} to ${toAgent}.`,
  };
}

/**
 * Broadcast a message from one agent to the entire team.
 *
 * @param fromAgent - The sending agent's ID.
 * @param content   - The broadcast message body.
 * @param type      - Message classification (defaults to "task").
 * @param sessionId - Optional session ID.
 * @param metadata  - Optional metadata.
 * @returns A SendResult for the broadcast.
 */
export async function broadcast(
  fromAgent: string,
  content: string,
  type: MessageType = "task",
  sessionId?: string,
  metadata?: Record<string, unknown>
): Promise<SendResult> {
  return sessions_send(fromAgent, TEAM_ID, content, type, sessionId, metadata);
}

/**
 * Escalate a message to the human operator.
 *
 * This is a convenience wrapper around sessions_send that sets the recipient
 * to "@human" and the type to "escalation". It also tags the message metadata
 * with the escalation reason for audit purposes.
 *
 * @param fromAgent - The agent raising the escalation.
 * @param content   - Description of the issue requiring human attention.
 * @param reason    - Short categorization of the escalation trigger.
 * @param sessionId - Optional session ID.
 * @returns A SendResult for the escalation.
 */
export async function escalateToHuman(
  fromAgent: string,
  content: string,
  reason: string,
  sessionId?: string
): Promise<SendResult> {
  return sessions_send(fromAgent, HUMAN_ID, content, "escalation", sessionId, {
    escalationReason: reason,
    severity: "high",
    requiresResponse: true,
  });
}

/**
 * Create a new communication session and return its ID.
 * Sessions group related messages into a single thread.
 *
 * @param initiator   - The agent starting the session.
 * @param participants - Agent IDs participating in this session.
 * @param topic       - Short description of the session's purpose.
 * @returns The generated session ID.
 */
export function createSession(
  initiator: string,
  participants: string[],
  topic: string
): string {
  const sessionId = randomUUID();

  const sessionMeta: AgentMessage = {
    id: randomUUID(),
    from: initiator,
    to: TEAM_ID,
    content: `Session started: ${topic}`,
    type: "task",
    timestamp: new Date().toISOString(),
    sessionId,
    metadata: {
      sessionEvent: "created",
      participants,
      topic,
    },
  };

  logToAuditTrail(sessionMeta);
  return sessionId;
}

/**
 * Close a communication session.
 *
 * @param sessionId - The session to close.
 * @param closedBy  - The agent closing the session.
 * @param summary   - Optional summary of outcomes.
 */
export function closeSession(
  sessionId: string,
  closedBy: string,
  summary?: string
): void {
  const closeMsg: AgentMessage = {
    id: randomUUID(),
    from: closedBy,
    to: TEAM_ID,
    content: summary ?? "Session closed.",
    type: "response",
    timestamp: new Date().toISOString(),
    sessionId,
    metadata: {
      sessionEvent: "closed",
      summary,
    },
  };

  logToAuditTrail(closeMsg);
}

/**
 * Get the path to the audit trail file for external tools or analysis.
 */
export function getAuditTrailPath(): string {
  return AUDIT_FILE;
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default {
  sessions_send,
  broadcast,
  escalateToHuman,
  createSession,
  closeSession,
  onMessage,
  offMessage,
  getAuditTrailPath,
};
