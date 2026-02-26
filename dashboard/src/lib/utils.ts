import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeElapsed(startTime: string, locale: string = "en"): string {
  const start = new Date(startTime);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (locale === "ar") {
    if (diffDays > 0) return `${diffDays} يوم`;
    if (diffHrs > 0) return `${diffHrs} ساعة`;
    return `${diffMins} دقيقة`;
  }

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHrs > 0) return `${diffHrs}hr`;
  return `${diffMins}min`;
}

export function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}
