"use client";

import React, { useState } from "react";
import {
  LayoutDashboard,
  MessageCircle,
  KanbanSquare,
  Bot,
  GitBranch,
  Brain,
  DollarSign,
  Shield,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Languages,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  mobileOpen?: boolean;
  onClose?: () => void;
  onCollapse?: (collapsed: boolean) => void;
}

const navItems = [
  { id: "dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { id: "conversation", icon: MessageCircle, labelKey: "nav.conversation" },
  { id: "kanban", icon: KanbanSquare, labelKey: "nav.kanban" },
  { id: "agents", icon: Bot, labelKey: "nav.agents" },
  { id: "workflows", icon: GitBranch, labelKey: "nav.workflows" },
  { id: "memory", icon: Brain, labelKey: "nav.memory" },
  { id: "modelsCost", icon: DollarSign, labelKey: "nav.modelsCost" },
  { id: "viadpAudit", icon: Shield, labelKey: "nav.viadpAudit" },
  { id: "settings", icon: Settings, labelKey: "nav.settings" },
];

export default function Sidebar({ activeTab, onTabChange, isDarkMode, onToggleTheme, mobileOpen, onClose, onCollapse }: SidebarProps) {
  const { locale, setLocale, direction, t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);

  const isRtl = direction === "rtl";

  const handleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  };

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    onClose?.();
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border/40">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-lg shrink-0">
          F
        </div>
        {!collapsed && (
          <div className="overflow-hidden flex-1 min-w-0">
            <h1 className="text-sm font-bold text-text-primary whitespace-nowrap">
              {t("app.title")}
            </h1>
            <p className="text-[10px] text-text-muted whitespace-nowrap">
              {t("app.subtitle")}
            </p>
          </div>
        )}
        {/* Mobile close button */}
        {mobileOpen && onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-light/40 transition-colors ms-auto"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const label = t(item.labelKey);
          const button = (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={cn(
                "sidebar-link w-full",
                isActive && "active",
                collapsed && "justify-center px-3"
              )}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && (
                <span className="whitespace-nowrap">{label}</span>
              )}
            </button>
          );
          if (collapsed) {
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side={isRtl ? "left" : "right"}>
                  <p>{label}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return button;
        })}
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-4 space-y-2 border-t border-border/40">
        {/* Language toggle */}
        {(() => {
          const langLabel = locale === "ar" ? "English" : "\u0627\u0644\u0639\u0631\u0628\u064A\u0629";
          const langButton = (
            <button
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className={cn(
                "sidebar-link w-full",
                collapsed && "justify-center px-3"
              )}
            >
              <Languages size={20} className="shrink-0" />
              {!collapsed && (
                <span className="whitespace-nowrap">{langLabel}</span>
              )}
            </button>
          );
          if (collapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>{langButton}</TooltipTrigger>
                <TooltipContent side={isRtl ? "left" : "right"}>
                  <p>{langLabel}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return langButton;
        })()}

        {/* Theme toggle */}
        {(() => {
          const themeLabel = isDarkMode ? t("common.light") : t("common.dark");
          const themeButton = (
            <button
              onClick={onToggleTheme}
              className={cn(
                "sidebar-link w-full",
                collapsed && "justify-center px-3"
              )}
            >
              {isDarkMode ? <Sun size={20} className="shrink-0" /> : <Moon size={20} className="shrink-0" />}
              {!collapsed && (
                <span className="whitespace-nowrap">{themeLabel}</span>
              )}
            </button>
          );
          if (collapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>{themeButton}</TooltipTrigger>
                <TooltipContent side={isRtl ? "left" : "right"}>
                  <p>{themeLabel}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return themeButton;
        })()}

        {/* Collapse toggle */}
        <button
          onClick={handleCollapse}
          className={cn(
            "sidebar-link w-full",
            collapsed && "justify-center px-3"
          )}
        >
          {isRtl ? (
            collapsed ? (
              <ChevronLeft size={20} className="shrink-0" />
            ) : (
              <ChevronRight size={20} className="shrink-0" />
            )
          ) : collapsed ? (
            <ChevronRight size={20} className="shrink-0" />
          ) : (
            <ChevronLeft size={20} className="shrink-0" />
          )}
          {!collapsed && (
            <span className="whitespace-nowrap">{t("common.collapse")}</span>
          )}
        </button>
      </div>
    </>
  );

  return (
    <TooltipProvider>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed top-0 start-0 h-screen z-50 flex-col transition-all duration-300",
          "bg-gradient-to-b from-[#0f1628] to-[#0a0f1e]",
          collapsed ? "w-[68px]" : "w-[240px]",
          "hidden lg:flex"
        )}
        style={{
          borderInlineEnd: "1px solid rgba(42, 74, 127, 0.4)",
        }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[200]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />
          {/* Drawer */}
          <aside
            className={cn(
              "absolute top-0 start-0 h-full w-[280px] flex flex-col transition-transform duration-300",
              "bg-gradient-to-b from-[#0f1628] to-[#0a0f1e]"
            )}
            style={{
              borderInlineEnd: "1px solid rgba(42, 74, 127, 0.4)",
            }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </TooltipProvider>
  );
}
