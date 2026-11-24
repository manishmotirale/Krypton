import type { ActionTracker } from "../agent/action-tracker";
import type { ToolExecutor } from "../agent/tool-executor";
import type { ActionLog } from "../agent/types";
import type { Plan } from "../plan/types";
import { formatApprovalSummary } from "../shared/bot-runner";

export interface WhatsAppPlanSession {
  plan: Plan;
  selected: Set<string>;
}

export interface WhatsAppApprovalSession {
  tracker: ActionTracker;
  executor: ToolExecutor;
  pending: ActionLog[];
}

export const waPlanSessions = new Map<string, WhatsAppPlanSession>();
export const waApprovalSessions = new Map<string, WhatsAppApprovalSession>();
export const waBusyChats = new Set<string>();

export function formatWhatsAppPlan(session: WhatsAppPlanSession): string {
  const lines = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? "✅" : "⬜";
    const tag = step.complexity ? ` [${step.complexity}]` : "";
    return `${mark} *${i + 1}.* ${step.title}${tag}`;
  });

  const research = session.plan.researchSummary?.trim()
    ? ["_Research Summary:_", session.plan.researchSummary.trim().slice(0, 600), ""]
    : [];

  return [
    `📋 *Plan for:* ${session.plan.goal}`,
    "",
    ...research,
    ...lines,
    "",
    `Selected: ${session.selected.size}/${session.plan.steps.length} step(s)`,
    "",
    "*Next actions:*",
    "• `toggle 1,3` — toggle step numbers (supports ranges like `2-4`)",
    "• `all` / `none` — select or clear all steps",
    "• `proceed` — execute selected steps",
    "• `cancel` — discard this plan",
  ].join("\n");
}

export function formatWhatsAppApproval(pending: ActionLog[]): string {
  return [
    formatApprovalSummary(pending),
    "",
    "*Reply with:*",
    "• `diff` — inspect unified diffs",
    "• `approve` — apply all staged changes",
    "• `reject` — discard all changes",
  ].join("\n");
}

/**
 * Parses strings like "1, 3, 5" or "2-4" into valid 1-based step indices.
 */
export function parseStepNumbers(input: string, maxStep: number): number[] {
  const indices = new Set<number>();
  const tokens = input.split(/[\s,]+/).filter(Boolean);

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      for (let n = low; n <= high; n++) {
        if (n >= 1 && n <= maxStep) indices.add(n);
      }
      continue;
    }

    const num = Number(token);
    if (Number.isInteger(num) && num >= 1 && num <= maxStep) {
      indices.add(num);
    }
  }

  return [...indices].sort((a, b) => a - b);
}
