"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MessageCircle,
  Send,
  Mic,
  MicOff,
  Volume2,
  Loader2,
  Plus,
  ChevronDown,
  X,
  Users,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { useSocket } from "@/lib/socket";
import type { GatewayMessageEvent, PartyModeSelectionEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import {
  fetchSessions,
  createSession,
  fetchVoiceStatus,
  transcribeAudio,
  synthesizeText,
} from "@/lib/api";
import type { Agent } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMsg {
  id: string;
  from: string;
  fromLabel: string;
  fromAvatar: string;
  to: string;
  toLabel: string;
  content: string;
  timestamp: string;
  isUser: boolean;
  audioBase64?: string;
  correlationId?: string;
  data?: Record<string, any>;
}

interface SessionInfo {
  id: string;
  label?: string;
  state?: string;
  createdAt?: string;
}

interface ConversationPanelProps {
  agents: Agent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatTimeDivider(ts: string, isAr: boolean): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const time = formatTimestamp(ts);
  if (isToday) return isAr ? `اليوم ${time}` : `Today ${time}`;
  const month = d.toLocaleDateString("en", { month: "short", day: "numeric" });
  return `${month}, ${time}`;
}

function shouldShowTimeDivider(prev: string | null, curr: string): boolean {
  if (!prev) return true;
  return new Date(curr).getTime() - new Date(prev).getTime() > 30 * 60 * 1000;
}

const ARABIC_AGENT_NAME_MAP: Record<string, string> = {
  "ونستون": "architect",
  "المعماري": "architect",
  "أميليا-BE": "backend-dev",
  "مطور الخلفية": "backend-dev",
  "أميليا-FE": "frontend-dev",
  "مطور الواجهة": "frontend-dev",
  "بوب": "scrum-master",
  "سكرم ماستر": "scrum-master",
  "جون": "product-owner",
  "مالك المنتج": "product-owner",
  "ماري": "business-analyst",
  "محلل الأعمال": "business-analyst",
  "سالي": "ux-designer",
  "مصمم": "ux-designer",
  "كوين": "qa-architect",
  "مهندس الجودة": "qa-architect",
  "باري": "devops-engineer",
  "مهندس DevOps": "devops-engineer",
  "شيلد": "security-specialist",
  "الأمن": "security-specialist",
  "بايج": "tech-writer",
  "الكاتب التقني": "tech-writer",
  "بي ماد": "bmad-master",
  "الكل": "broadcast",
};

function highlightMentions(text: string): React.ReactNode {
  const parts = text.split(/(@human|@إنسان)/gi);
  return parts.map((part, i) => {
    if (/^@(human|إنسان)$/i.test(part)) {
      return (
        <span key={i} className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold text-xs">
          {part}
        </span>
      );
    }
    return part;
  });
}

function parseMentions(text: string): string | null {
  const mentionRegex = /@([\w-]+|[\u0600-\u06FF]+)/;
  const match = text.match(mentionRegex);
  if (!match) return null;
  const name = match[1];
  if (name === "everyone" || name === "الكل") return "broadcast";
  if (ARABIC_AGENT_NAME_MAP[name]) return ARABIC_AGENT_NAME_MAP[name];
  return name;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConversationPanel({ agents }: ConversationPanelProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const { on, emit } = useSocket();

  // Agent lookup map
  const agentMap = useMemo(() => {
    const m: Record<string, Agent> = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  // --- Session state ---
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);

  // --- Messages ---
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  // --- DM Panel ---
  const [dmAgent, setDmAgent] = useState<string | null>(null);

  // --- Input ---
  const [inputText, setInputText] = useState("");
  const [dmInputText, setDmInputText] = useState("");
  const [sendTarget, setSendTarget] = useState<string>("broadcast");

  // --- Voice ---
  const [isRecording, setIsRecording] = useState(false);
  const [isDmRecording, setIsDmRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDmTranscribing, setIsDmTranscribing] = useState(false);
  const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState({ stt: false, tts: false });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dmMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const dmAudioChunksRef = useRef<Blob[]>([]);

  // --- Refs ---
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dmMessagesEndRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // --- Party Mode ---
  const [partyModeThinking, setPartyModeThinking] = useState<PartyModeSelectionEvent | null>(null);

  // --- Load sessions on mount, auto-create if none ---
  useEffect(() => {
    fetchSessions()
      .then(async (res) => {
        const list = (res.sessions ?? []).map((s: any) => ({
          id: s?.id ?? "",
          label: s?.label ?? s?.metadata?.project ?? s?.id,
          state: s?.state,
          createdAt: s?.createdAt,
        }));
        if (list.length > 0) {
          setSessions(list);
          setSessionId(list[0].id);
        } else {
          const created: any = await createSession({ label: "Default Session" });
          const s = created.session;
          const info: SessionInfo = {
            id: s?.id ?? "",
            label: s?.label ?? "Default Session",
            state: s?.state,
            createdAt: s?.createdAt,
          };
          setSessions([info]);
          setSessionId(info.id);
        }
      })
      .catch(() => {});

    fetchVoiceStatus()
      .then((res) => setVoiceEnabled(res.status?.configured ?? { stt: false, tts: false }))
      .catch(() => {});
  }, []);

  // --- Socket: listen for messages ---
  useEffect(() => {
    const unsub = on("message", (data: GatewayMessageEvent) => {
      if (sessionId && data.sessionId !== sessionId) return;

      const fromAgent = agentMap[data.from];
      const toAgent = agentMap[data.to];
      const isFromUser = data.from === "user" || data.from === "dashboard";

      const msg: ChatMsg = {
        id: data.id,
        from: data.from,
        fromLabel: isFromUser
          ? t("conversation.you")
          : fromAgent
            ? isAr ? fromAgent.nameAr : fromAgent.name
            : data.from,
        fromAvatar: isFromUser ? "" : fromAgent?.avatar ?? "",
        to: data.to,
        toLabel: data.to === "broadcast"
          ? t("conversation.broadcast")
          : toAgent
            ? isAr ? toAgent.nameAr : toAgent.name
            : data.to,
        content: data.payload?.content ?? "",
        timestamp: data.timestamp,
        isUser: isFromUser,
        correlationId: data.correlationId,
        data: data.payload?.data as Record<string, any> | undefined,
      };

      // Clear party mode thinking when the first response arrives for this correlation
      if (!isFromUser && (data as any).correlationId) {
        setPartyModeThinking((prev) =>
          prev?.correlationId === (data as any).correlationId ? null : prev
        );
      }

      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });

      if (isFromUser) return;
      if (userScrolledUp) {
        setUnreadCount((c) => c + 1);
      }
    });
    return unsub;
  }, [on, sessionId, agentMap, isAr, t, userScrolledUp]);

  // --- Socket: listen for party mode selections ---
  useEffect(() => {
    const unsub = on("party_mode_selection" as any, (data: PartyModeSelectionEvent) => {
      if (sessionId && data.sessionId !== sessionId) return;
      setPartyModeThinking(data);
    });
    return unsub;
  }, [on, sessionId]);

  // --- Auto-scroll ---
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    }
  }, [messages, userScrolledUp]);

  useEffect(() => {
    dmMessagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, [messages, dmAgent]);

  const handleMainScroll = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    setUserScrolledUp(!atBottom);
    if (atBottom) setUnreadCount(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
    setUnreadCount(0);
  }, []);

  // --- Send message ---
  const sendMessage = useCallback(
    (content: string, to: string) => {
      if (!content.trim() || !sessionId) return;

      const mentionTarget = parseMentions(content);
      const effectiveTo = mentionTarget ?? to;

      const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toAgent = agentMap[effectiveTo];

      const msg: ChatMsg = {
        id,
        from: "user",
        fromLabel: t("conversation.you"),
        fromAvatar: "",
        to: effectiveTo,
        toLabel: effectiveTo === "broadcast"
          ? t("conversation.broadcast")
          : toAgent
            ? isAr ? toAgent.nameAr : toAgent.name
            : effectiveTo,
        content: content.trim(),
        timestamp: new Date().toISOString(),
        isUser: true,
      };

      setMessages((prev) => [...prev, msg]);

      emit("chat.message", {
        payload: { to: effectiveTo, content: content.trim(), correlationId: id },
        sessionId,
      });

      if (mentionTarget && mentionTarget !== to) {
        setSendTarget(mentionTarget);
      }
    },
    [sessionId, agentMap, isAr, t, emit]
  );

  const handleSendMain = useCallback(() => {
    sendMessage(inputText, sendTarget);
    setInputText("");
  }, [inputText, sendTarget, sendMessage]);

  const handleSendDm = useCallback(() => {
    if (!dmAgent) return;
    sendMessage(dmInputText, dmAgent);
    setDmInputText("");
  }, [dmInputText, dmAgent, sendMessage]);

  // --- Create session ---
  const handleCreateSession = useCallback(async () => {
    const label = isAr ? "جلسة جديدة" : "New Session";
    try {
      const res: any = await createSession({ label });
      const s = res.session;
      const info: SessionInfo = {
        id: s?.id ?? "",
        label: s?.label ?? label,
        state: s?.state,
        createdAt: s?.createdAt,
      };
      setSessions((prev) => [info, ...prev]);
      setSessionId(info.id);
      setMessages([]);
      setShowSessionDropdown(false);
    } catch {}
  }, [isAr]);

  // --- Voice: STT (main) ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          setIsTranscribing(true);
          try {
            const res = await transcribeAudio(base64, isAr ? "ar" : "en");
            if (res.result?.text) setInputText((prev) => prev + res.result.text);
          } catch {}
          setIsTranscribing(false);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {}
  }, [isAr]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // --- Voice: STT (DM) ---
  const startDmRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      dmAudioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) dmAudioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(dmAudioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];
          setIsDmTranscribing(true);
          try {
            const res = await transcribeAudio(base64, isAr ? "ar" : "en");
            if (res.result?.text) setDmInputText((prev) => prev + res.result.text);
          } catch {}
          setIsDmTranscribing(false);
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      dmMediaRecorderRef.current = recorder;
      setIsDmRecording(true);
    } catch {}
  }, [isAr]);

  const stopDmRecording = useCallback(() => {
    if (dmMediaRecorderRef.current?.state === "recording") {
      dmMediaRecorderRef.current.stop();
    }
    setIsDmRecording(false);
  }, []);

  // --- Voice: TTS ---
  const playTTS = useCallback(
    async (msg: ChatMsg) => {
      if (playingMsgId) return;
      setPlayingMsgId(msg.id);
      try {
        let audioB64 = msg.audioBase64;
        if (!audioB64) {
          const res = await synthesizeText(msg.content, isAr ? "ar" : "en");
          audioB64 = res.result?.audioBase64;
          if (audioB64) {
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, audioBase64: audioB64 } : m))
            );
          }
        }
        if (audioB64) {
          const audio = new Audio(`data:audio/mpeg;base64,${audioB64}`);
          audio.onended = () => setPlayingMsgId(null);
          audio.onerror = () => setPlayingMsgId(null);
          await audio.play();
        } else {
          setPlayingMsgId(null);
        }
      } catch {
        setPlayingMsgId(null);
      }
    },
    [playingMsgId, isAr]
  );

  // --- TTS button component (reusable for agent-to-user and agent-to-agent) ---
  const ttsButton = useCallback(
    (msg: ChatMsg) => {
      if (!voiceEnabled.tts) return null;
      return (
        <button
          onClick={() => playTTS(msg)}
          disabled={playingMsgId !== null}
          className={cn(
            "mt-1.5 flex items-center gap-1 text-[10px] transition-colors",
            playingMsgId === msg.id
              ? "text-primary-light"
              : "text-text-muted/40 hover:text-text-muted"
          )}
        >
          {playingMsgId === msg.id ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Volume2 size={10} />
          )}
          <span>
            {playingMsgId === msg.id
              ? t("conversation.playing")
              : t("conversation.play")}
          </span>
        </button>
      );
    },
    [voiceEnabled.tts, playingMsgId, playTTS, t]
  );

  // --- DM filtered messages ---
  const dmMessages = useMemo(() => {
    if (!dmAgent) return [];
    return messages.filter(
      (m) =>
        (m.from === dmAgent && (m.to === "user" || m.to === "broadcast")) ||
        (m.isUser && m.to === dmAgent)
    );
  }, [messages, dmAgent]);

  const dmAgentInfo = dmAgent ? agentMap[dmAgent] : null;

  // --- Current session label ---
  const currentSessionLabel = useMemo(() => {
    const s = sessions.find((s) => s.id === sessionId);
    return s?.label ?? sessionId?.slice(0, 8) ?? t("conversation.selectSession");
  }, [sessions, sessionId, t]);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* -- Session Header -- */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <button
            onClick={() => setShowSessionDropdown(!showSessionDropdown)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg",
              "bg-surface-light/40 border border-border/30 text-sm text-text-primary",
              "hover:bg-surface-light/60 transition-colors"
            )}
          >
            <span className="truncate max-w-[200px]">{currentSessionLabel}</span>
            <ChevronDown size={14} className="text-text-muted shrink-0" />
          </button>

          {showSessionDropdown && (
            <div
              className={cn(
                "absolute top-full mt-1 z-50 w-[280px] glass-card p-2 rounded-lg",
                "border border-border/30 shadow-lg"
              )}
              style={{ insetInlineStart: 0 }}
            >
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSessionId(s.id);
                    setMessages([]);
                    setShowSessionDropdown(false);
                  }}
                  className={cn(
                    "w-full text-start px-3 py-2 rounded-md text-sm transition-colors",
                    s.id === sessionId
                      ? "bg-primary/20 text-primary-light"
                      : "text-text-secondary hover:bg-surface-light/40"
                  )}
                >
                  <span className="truncate block">{s.label ?? s.id.slice(0, 8)}</span>
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="text-xs text-text-muted/50 text-center py-3">
                  {t("conversation.noMessages")}
                </p>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleCreateSession}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm",
            "bg-primary/20 text-primary-light border border-primary/30",
            "hover:bg-primary/30 transition-colors"
          )}
        >
          <Plus size={14} />
          <span>{t("conversation.newSession")}</span>
        </button>
      </div>

      {/* -- Content Area -- */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* -- Main Chat Panel -- */}
        <div
          className={cn(
            "flex flex-col flex-1 min-w-0 glass-card overflow-hidden transition-all duration-300",
            dmAgent ? "lg:me-0" : ""
          )}
        >
          {/* Messages area */}
          <div
            ref={mainScrollRef}
            onScroll={handleMainScroll}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <MessageCircle size={28} className="text-primary-light" />
                </div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  {t("conversation.emptyState")}
                </h3>
                <p className="text-xs text-text-muted/60 max-w-xs">
                  {t("conversation.emptyStateHint")}
                </p>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const prevTs = idx > 0 ? messages[idx - 1].timestamp : null;
                  const showDivider = shouldShowTimeDivider(prevTs, msg.timestamp);
                  const isAgentToAgent =
                    !msg.isUser &&
                    msg.to !== "user" &&
                    msg.to !== "dashboard" &&
                    msg.to !== "broadcast" &&
                    agentMap[msg.to];

                  return (
                    <React.Fragment key={msg.id}>
                      {showDivider && (
                        <div className="flex items-center gap-3 py-3">
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
                          <span className="text-[10px] text-text-muted/50 ltr-nums whitespace-nowrap">
                            {formatTimeDivider(msg.timestamp, isAr)}
                          </span>
                          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border/30 to-transparent" />
                        </div>
                      )}

                      {/* User bubble */}
                      {msg.isUser && (
                        <div className="flex justify-end mb-3">
                          <div className="max-w-[70%]">
                            <div className="flex items-center gap-2 mb-1 justify-end">
                              <span className="text-[10px] text-text-muted/50 ltr-nums">
                                {formatTimestamp(msg.timestamp)}
                              </span>
                              <span className="text-xs font-semibold text-accent">
                                {msg.fromLabel}
                              </span>
                              {msg.to !== "broadcast" && (
                                <>
                                  <span className="text-text-muted/40 text-[10px]">
                                    {isAr ? "\u2190" : "\u2192"}
                                  </span>
                                  <span className="text-xs text-text-secondary">
                                    {msg.toLabel}
                                  </span>
                                </>
                              )}
                            </div>
                            <div
                              className={cn(
                                "px-4 py-2.5 rounded-2xl rounded-ee-md",
                                "bg-gradient-to-br from-[rgba(218,165,32,0.12)] to-[rgba(218,165,32,0.04)]",
                                "border border-accent/20"
                              )}
                            >
                              <p className="text-xs text-text-primary leading-relaxed" dir="auto">
                                {highlightMentions(msg.content)}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Agent-to-agent bubble */}
                      {!msg.isUser && isAgentToAgent && (
                        <div className="flex justify-start mb-2 mx-8 opacity-70 hover:opacity-100 transition-opacity">
                          <div className="max-w-[80%] border-s-2 border-[rgba(59,130,246,0.25)] ps-3">
                            <div className="flex items-center gap-2 mb-1">
                              <button
                                onClick={() => setDmAgent(msg.from)}
                                className="text-base shrink-0 hover:scale-110 transition-transform"
                                title={msg.fromLabel}
                              >
                                {msg.fromAvatar}
                              </button>
                              <span className="text-[11px] font-medium text-text-secondary">
                                {msg.fromLabel}
                              </span>
                              <ArrowLeftRight size={10} className="text-text-muted/40" />
                              <span className="text-[11px] text-text-secondary">
                                {msg.toLabel}
                              </span>
                              <span className="text-[10px] text-text-muted/50 ltr-nums ms-auto">
                                {formatTimestamp(msg.timestamp)}
                              </span>
                            </div>
                            <p className="text-[12px] text-text-secondary leading-relaxed" dir="auto">
                              {highlightMentions(msg.content)}
                            </p>
                            {ttsButton(msg)}
                          </div>
                        </div>
                      )}

                      {/* Agent-to-user / Agent broadcast bubble */}
                      {!msg.isUser && !isAgentToAgent && (() => {
                        const data = (msg as any).payload?.data ?? (msg as any).data;
                        const isPartyMode = data?.partyMode === true;
                        const agentRole = data?.agentRole as string | undefined;
                        const correlationId = (msg as any).correlationId;

                        // Check if this is the first party mode msg in its group
                        const isFirstInGroup = isPartyMode && (() => {
                          for (let j = idx - 1; j >= 0; j--) {
                            const prev = messages[j];
                            if (prev.isUser) return true;
                            const prevData = (prev as any).payload?.data ?? (prev as any).data;
                            if (prevData?.partyMode && (prev as any).correlationId === correlationId) return false;
                            return true;
                          }
                          return true;
                        })();

                        // Check if this is the last party mode msg in its group (for follow-up chips)
                        const isLastInGroup = isPartyMode && (() => {
                          for (let j = idx + 1; j < messages.length; j++) {
                            const next = messages[j];
                            if (next.isUser) return true;
                            const nextData = (next as any).payload?.data ?? (next as any).data;
                            if (nextData?.partyMode && (next as any).correlationId === correlationId) return false;
                            return true;
                          }
                          return true;
                        })();

                        return (
                          <>
                            {/* Party Mode group header */}
                            {isFirstInGroup && isPartyMode && (
                              <div className="flex items-center gap-2 mb-2 mt-1">
                                <Sparkles size={12} className="text-purple-400" />
                                <span className="text-[10px] font-semibold text-purple-300">
                                  {isAr ? "\uD83C\uDF89 \u0648\u0636\u0639 \u0627\u0644\u062D\u0641\u0644\u0629" : "\uD83C\uDF89 Party Mode"}
                                </span>
                                <div className="flex-1 h-px bg-gradient-to-r from-purple-500/30 to-transparent" />
                              </div>
                            )}

                            <div className={cn(
                              "flex justify-start mb-3",
                              isPartyMode && "ps-2 border-s-2 border-purple-500/30"
                            )}>
                              <div className="max-w-[70%]">
                                <div className="flex items-center gap-2 mb-1">
                                  <button
                                    onClick={() => setDmAgent(msg.from)}
                                    className="text-lg shrink-0 hover:scale-110 transition-transform"
                                    title={msg.fromLabel}
                                  >
                                    {msg.fromAvatar}
                                  </button>
                                  <span className="text-xs font-semibold text-text-primary">
                                    {msg.fromLabel}
                                  </span>
                                  {agentRole && (
                                    <span className={cn(
                                      "text-[9px] px-1.5 py-0.5 rounded-full font-medium",
                                      agentRole === "primary" ? "bg-purple-500/20 text-purple-300" :
                                      agentRole === "secondary" ? "bg-blue-500/20 text-blue-300" :
                                      "bg-emerald-500/20 text-emerald-300"
                                    )}>
                                      {isAr ? (agentRole === "primary" ? "\u0623\u0633\u0627\u0633\u064A" : agentRole === "secondary" ? "\u062B\u0627\u0646\u0648\u064A" : "\u0625\u0636\u0627\u0641\u064A") : agentRole.charAt(0).toUpperCase() + agentRole.slice(1)}
                                    </span>
                                  )}
                                  {msg.to && msg.to !== "user" && msg.to !== "dashboard" && !isPartyMode && (
                                    <>
                                      <span className="text-text-muted/40 text-[10px]">
                                        {isAr ? "\u2190" : "\u2192"}
                                      </span>
                                      <span className="text-xs text-text-secondary">
                                        {msg.toLabel}
                                      </span>
                                    </>
                                  )}
                                  <span className="text-[10px] text-text-muted/50 ltr-nums ms-auto">
                                    {formatTimestamp(msg.timestamp)}
                                  </span>
                                </div>
                                <div
                                  className={cn(
                                    "px-4 py-2.5 rounded-2xl rounded-ss-md",
                                    isPartyMode
                                      ? "bg-gradient-to-br from-[rgba(139,92,246,0.12)] to-[rgba(26,26,46,0.6)] border border-purple-500/20 backdrop-blur-sm"
                                      : "bg-gradient-to-br from-[rgba(15,52,96,0.5)] to-[rgba(26,26,46,0.6)] border border-border/30 backdrop-blur-sm"
                                  )}
                                >
                                  {data?.taskId && (
                                    <div className="flex items-center gap-1 mb-1.5 text-[10px] text-blue-300/80">
                                      <span>\uD83D\uDCCB</span>
                                      <span>{isAr ? "\u064A\u0639\u0645\u0644 \u0639\u0644\u0649:" : "Working on:"} {data.taskId}</span>
                                    </div>
                                  )}
                                  <p className="text-xs text-text-secondary leading-relaxed" dir="auto">
                                    {highlightMentions(msg.content)}
                                  </p>
                                  {ttsButton(msg)}
                                </div>
                              </div>
                            </div>

                            {/* Follow-up agent chips after last party mode message */}
                            {isLastInGroup && isPartyMode && (
                              <div className="flex items-center gap-2 mb-3 ps-2 flex-wrap">
                                <span className="text-[10px] text-text-muted/60">
                                  {isAr ? "\uD83D\uDCAC \u0633\u0624\u0627\u0644 \u0645\u062A\u0627\u0628\u0639\u0629:" : "\uD83D\uDCAC Ask follow-up:"}
                                </span>
                                {(() => {
                                  // Collect all party mode agents from this group
                                  const groupAgentIds = new Set<string>();
                                  for (let j = idx; j >= 0; j--) {
                                    const m = messages[j];
                                    if (m.isUser) break;
                                    const d = (m as any).payload?.data ?? (m as any).data;
                                    if (d?.partyMode && (m as any).correlationId === correlationId) {
                                      groupAgentIds.add(m.from);
                                    } else break;
                                  }
                                  groupAgentIds.add(msg.from);
                                  return Array.from(groupAgentIds).map((aid) => {
                                    const a = agentMap[aid];
                                    if (!a) return null;
                                    return (
                                      <button
                                        key={aid}
                                        onClick={() => setSendTarget(aid)}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-surface-light/40 border border-border/30 text-text-secondary hover:bg-surface-light/60 transition-colors"
                                      >
                                        <span>{a.avatar}</span>
                                        <span>{isAr ? a.nameAr : a.name}</span>
                                      </button>
                                    );
                                  });
                                })()}
                                <button
                                  onClick={() => setSendTarget("bmad-master")}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-surface-light/40 border border-border/30 text-text-secondary hover:bg-surface-light/60 transition-colors"
                                >
                                  <span>\uD83C\uDFAF</span>
                                  <span>{isAr ? "\u0628\u064A \u0645\u0627\u062F \u0645\u0627\u0633\u062A\u0631" : "BMad Master"}</span>
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}
                {/* Party Mode thinking indicator */}
                {partyModeThinking && (
                  <div className="flex justify-start mb-3">
                    <div className="max-w-[80%]">
                      <div className="px-4 py-3 rounded-2xl bg-gradient-to-br from-[rgba(139,92,246,0.15)] to-[rgba(59,130,246,0.08)] border border-purple-500/25 backdrop-blur-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles size={14} className="text-purple-400 animate-pulse" />
                          <span className="text-xs font-semibold text-purple-300">
                            {isAr ? "\u0648\u0636\u0639 \u0627\u0644\u062D\u0641\u0644\u0629 \u2014 \u0627\u0633\u062A\u0634\u0627\u0631\u0629:" : "Party Mode \u2014 consulting:"}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {partyModeThinking.selections.map((sel) => {
                            const agent = agentMap[sel.agentId];
                            return (
                              <div
                                key={sel.agentId}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10"
                                title={sel.reason}
                              >
                                <span className="text-base animate-pulse">{agent?.avatar ?? "\uD83E\uDD16"}</span>
                                <span className="text-[11px] text-text-secondary">
                                  {agent ? (isAr ? agent.nameAr : agent.name) : sel.agentId}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-1 mt-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Scroll-to-bottom FAB */}
          {userScrolledUp && (
            <div className="relative">
              <button
                onClick={scrollToBottom}
                className={cn(
                  "absolute bottom-2 z-10 p-2 rounded-full",
                  "bg-surface-card/90 backdrop-blur-md border border-border/40 shadow-lg",
                  "hover:bg-surface-light/60 transition-all"
                )}
                style={{ insetInlineEnd: "16px" }}
              >
                <ChevronDown size={16} className="text-text-primary" />
                {unreadCount > 0 && (
                  <span
                    className={cn(
                      "absolute -top-1 w-4 h-4 rounded-full",
                      "bg-accent text-[9px] text-black font-bold flex items-center justify-center"
                    )}
                    style={{ insetInlineEnd: "-4px" }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* -- Agent Selector + Input Bar -- */}
          <div className="border-t border-border/20 px-4 py-3">
            {/* Agent chips */}
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSendTarget("broadcast")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors shrink-0",
                  sendTarget === "broadcast"
                    ? "bg-primary/20 text-primary-light border border-primary/40"
                    : "bg-surface-light/30 text-text-muted border border-transparent hover:bg-surface-light/50"
                )}
              >
                <Users size={12} />
                {t("conversation.broadcast")}
              </button>
              <div className="w-px bg-border/30 shrink-0" />
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSendTarget(agent.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors shrink-0",
                    sendTarget === agent.id
                      ? "bg-primary/20 text-primary-light border border-primary/40"
                      : "bg-surface-light/30 text-text-muted border border-transparent hover:bg-surface-light/50"
                  )}
                  title={isAr ? agent.nameAr : agent.name}
                >
                  <span className="text-sm">{agent.avatar}</span>
                  <span>{isAr ? agent.nameAr : agent.name}</span>
                </button>
              ))}
            </div>

            {/* Input row */}
            <div className="flex items-center gap-2">
              {/* Mic button - always shown, disabled when STT not configured */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={voiceEnabled.stt ? (isRecording ? stopRecording : startRecording) : undefined}
                      disabled={isTranscribing || !voiceEnabled.stt}
                      className={cn(
                        "p-2.5 rounded-xl transition-colors shrink-0",
                        !voiceEnabled.stt
                          ? "text-text-muted/20 cursor-not-allowed"
                          : isRecording
                            ? "bg-danger/20 text-danger animate-pulse"
                            : isTranscribing
                              ? "text-text-muted/30"
                              : "text-text-muted hover:text-primary-light"
                      )}
                    >
                      {isTranscribing ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : isRecording ? (
                        <MicOff size={18} />
                      ) : (
                        <Mic size={18} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {!voiceEnabled.stt
                        ? t("conversation.voiceNotConfiguredTooltip")
                        : isRecording
                          ? t("conversation.micRecording")
                          : isTranscribing
                            ? t("conversation.micTranscribing")
                            : t("conversation.mic")}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Text input */}
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMain();
                  }
                }}
                placeholder={
                  sendTarget === "broadcast"
                    ? t("conversation.placeholder")
                    : `${t("conversation.sendTo")} ${agentMap[sendTarget] ? (isAr ? agentMap[sendTarget].nameAr : agentMap[sendTarget].name) : sendTarget}...`
                }
                className={cn(
                  "flex-1 bg-surface-light/50 text-text-primary text-sm rounded-xl px-4 py-2.5",
                  "border border-border/30 focus:outline-none focus:border-primary/50",
                  "placeholder:text-text-muted/50"
                )}
                dir="auto"
              />

              {/* Send button */}
              <Button
                onClick={handleSendMain}
                disabled={!inputText.trim()}
                size="icon"
                className={cn(
                  "rounded-xl shrink-0",
                  inputText.trim()
                    ? "bg-primary text-white shadow-[0_0_12px_rgba(0,100,0,0.3)] hover:bg-primary-light"
                    : "text-text-muted/30 bg-transparent cursor-not-allowed"
                )}
              >
                <Send size={18} />
              </Button>
            </div>
          </div>
        </div>

        {/* -- DM Side Panel -- */}
        {dmAgent && dmAgentInfo && (
          <div
            className={cn(
              "w-80 flex flex-col glass-card border-s border-border/30 overflow-hidden shrink-0"
            )}
          >
            {/* DM Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/20">
              <span className="text-2xl">{dmAgentInfo.avatar}</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-text-primary truncate">
                  {t("conversation.dmWith")} {isAr ? dmAgentInfo.nameAr : dmAgentInfo.name}
                </h3>
                <p className="text-[10px] text-text-muted">
                  {isAr ? dmAgentInfo.roleAr : dmAgentInfo.role}
                </p>
              </div>
              <button
                onClick={() => setDmAgent(null)}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-light/40 transition-colors"
                title={t("conversation.closePanel")}
              >
                <X size={16} />
              </button>
            </div>

            {/* DM Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
              {dmMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-text-muted/40">{t("conversation.noMessages")}</p>
                </div>
              ) : (
                <>
                  {dmMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex mb-2",
                        msg.isUser ? "justify-end" : "justify-start"
                      )}
                    >
                      <div className="max-w-[85%]">
                        <div
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs leading-relaxed",
                            msg.isUser
                              ? "bg-gradient-to-br from-[rgba(218,165,32,0.12)] to-[rgba(218,165,32,0.04)] border border-accent/20 text-text-primary rounded-ee-md"
                              : "bg-surface-light/30 border border-border/30 text-text-secondary rounded-ss-md"
                          )}
                          dir="auto"
                        >
                          {highlightMentions(msg.content)}
                        </div>
                        <span className={cn(
                          "text-[9px] text-text-muted/40 ltr-nums mt-0.5 block",
                          msg.isUser ? "text-end" : "text-start"
                        )}>
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div ref={dmMessagesEndRef} />
                </>
              )}
            </div>

            {/* DM Input */}
            <div className="px-3 py-2 border-t border-border/20">
              <div className="flex items-center gap-2">
                {/* DM Mic button */}
                <button
                  onClick={voiceEnabled.stt ? (isDmRecording ? stopDmRecording : startDmRecording) : undefined}
                  disabled={isDmTranscribing || !voiceEnabled.stt}
                  className={cn(
                    "p-2 rounded-lg transition-colors shrink-0",
                    !voiceEnabled.stt
                      ? "text-text-muted/20 cursor-not-allowed"
                      : isDmRecording
                        ? "bg-danger/20 text-danger animate-pulse"
                        : isDmTranscribing
                          ? "text-text-muted/30"
                          : "text-text-muted hover:text-primary-light"
                  )}
                  title={
                    !voiceEnabled.stt
                      ? t("conversation.voiceNotConfiguredTooltip")
                      : isDmRecording
                        ? t("conversation.micRecording")
                        : isDmTranscribing
                          ? t("conversation.micTranscribing")
                          : t("conversation.mic")
                  }
                >
                  {isDmTranscribing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : isDmRecording ? (
                    <MicOff size={14} />
                  ) : (
                    <Mic size={14} />
                  )}
                </button>

                <input
                  type="text"
                  value={dmInputText}
                  onChange={(e) => setDmInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendDm();
                    }
                  }}
                  placeholder={t("conversation.placeholder")}
                  className={cn(
                    "flex-1 bg-surface-light/50 text-text-primary text-xs rounded-lg px-3 py-2",
                    "border border-border/30 focus:outline-none focus:border-primary/50",
                    "placeholder:text-text-muted/50"
                  )}
                  dir="auto"
                />
                <Button
                  onClick={handleSendDm}
                  disabled={!dmInputText.trim()}
                  size="icon"
                  className={cn(
                    "rounded-lg shrink-0 h-8 w-8",
                    dmInputText.trim()
                      ? "bg-primary text-white hover:bg-primary-light"
                      : "text-text-muted/30 bg-transparent cursor-not-allowed"
                  )}
                >
                  <Send size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
