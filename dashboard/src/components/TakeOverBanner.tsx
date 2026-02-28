"use client";

import React, { useState } from "react";
import { UserX, Send } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

interface TakeOverBannerProps {
  agentId: string;
  agentName: string;
  agentNameAr: string;
  agentAvatar: string;
  onRelease: () => void;
  onSendMessage: (content: string) => void;
}

export default function TakeOverBanner({
  agentName,
  agentNameAr,
  agentAvatar,
  onRelease,
  onSendMessage,
}: TakeOverBannerProps) {
  const { locale, t } = useLocale();
  const isAr = locale === "ar";
  const [messageText, setMessageText] = useState("");

  return (
    <div className="glass-card border-2 border-amber-500/50 p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{agentAvatar}</span>
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-400">
            {t("takeover.controlling")} {isAr ? agentNameAr : agentName}
          </p>
        </div>
        <button
          onClick={onRelease}
          className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium flex items-center gap-1"
        >
          <UserX size={12} />
          {t("takeover.release")}
        </button>
      </div>
      <div className="flex gap-2">
        <input
          dir="auto"
          type="text"
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && messageText.trim()) {
              onSendMessage(messageText.trim());
              setMessageText("");
            }
          }}
          placeholder={t("takeover.messagePlaceholder")}
          className="flex-1 px-3 py-2 rounded-lg bg-surface-light/30 border border-amber-500/30 text-text-primary text-sm focus:outline-none focus:border-amber-500/60"
        />
        <button
          onClick={() => {
            if (messageText.trim()) {
              onSendMessage(messageText.trim());
              setMessageText("");
            }
          }}
          className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors flex items-center gap-1"
        >
          <Send size={14} />
          {t("takeover.send")}
        </button>
      </div>
    </div>
  );
}
