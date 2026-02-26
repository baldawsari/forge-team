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
  { id: "dashboard", icon: LayoutDashboard, enLabel: "Dashboard", arLabel: "لوحة التحكم" },
  { id: "conversation", icon: MessageCircle, enLabel: "Conversation", arLabel: "المحادثة" },
  { id: "kanban", icon: KanbanSquare, enLabel: "Kanban", arLabel: "كانبان" },
  { id: "agents", icon: Bot, enLabel: "Agents", arLabel: "الوكلاء" },
  { id: "workflows", icon: GitBranch, enLabel: "Workflows", arLabel: "سير العمل" },
  { id: "memory", icon: Brain, enLabel: "Memory", arLabel: "الذاكرة" },
  { id: "modelsCost", icon: DollarSign, enLabel: "Models & Cost", arLabel: "النماذج والتكلفة" },
  { id: "viadpAudit", icon: Shield, enLabel: "VIADP Audit", arLabel: "تدقيق التفويض" },
  { id: "settings", icon: Settings, enLabel: "Settings", arLabel: "الإعدادات" },
];

export default function Sidebar({ activeTab, onTabChange, isDarkMode, onToggleTheme, mobileOpen, onClose, onCollapse }: SidebarProps) {
  const { locale, setLocale, direction } = useLocale();
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
              {locale === "ar" ? "فورج تيم" : "ForgeTeam"}
            </h1>
            <p className="text-[10px] text-text-muted whitespace-nowrap">
              {locale === "ar" ? "إصدار BMAD-Claw" : "BMAD-Claw Edition"}
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
          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={cn(
                "sidebar-link w-full",
                isActive && "active",
                collapsed && "justify-center px-3"
              )}
              title={collapsed ? (locale === "ar" ? item.arLabel : item.enLabel) : undefined}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && (
                <span className="whitespace-nowrap">
                  {locale === "ar" ? item.arLabel : item.enLabel}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="px-3 py-4 space-y-2 border-t border-border/40">
        {/* Language toggle */}
        <button
          onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
          className={cn(
            "sidebar-link w-full",
            collapsed && "justify-center px-3"
          )}
          title={collapsed ? (locale === "ar" ? "English" : "العربية") : undefined}
        >
          <Languages size={20} className="shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap">
              {locale === "ar" ? "English" : "العربية"}
            </span>
          )}
        </button>

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className={cn(
            "sidebar-link w-full",
            collapsed && "justify-center px-3"
          )}
          title={collapsed ? (isDarkMode ? "Light" : "Dark") : undefined}
        >
          {isDarkMode ? <Sun size={20} className="shrink-0" /> : <Moon size={20} className="shrink-0" />}
          {!collapsed && (
            <span className="whitespace-nowrap">
              {isDarkMode
                ? locale === "ar"
                  ? "فاتح"
                  : "Light"
                : locale === "ar"
                  ? "داكن"
                  : "Dark"}
            </span>
          )}
        </button>

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
            <span className="whitespace-nowrap">
              {locale === "ar" ? "طي" : "Collapse"}
            </span>
          )}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed top-0 h-screen z-50 flex-col transition-all duration-300",
          "bg-gradient-to-b from-[#0f1628] to-[#0a0f1e] border-border",
          isRtl ? "right-0 border-l" : "left-0 border-r",
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
              "absolute top-0 h-full w-[280px] flex flex-col transition-transform duration-300",
              "bg-gradient-to-b from-[#0f1628] to-[#0a0f1e]",
              isRtl ? "right-0" : "left-0"
            )}
            style={{
              borderInlineEnd: "1px solid rgba(42, 74, 127, 0.4)",
            }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
