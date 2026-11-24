import { Markup } from "telegraf";
import type { ActionTracker } from "../agent/action-tracker";
import type { ToolExecutor } from "../agent/tool-executor";
import type { ActionLog } from "../agent/types";
import {
  formatApprovalDiff,
  formatApprovalSummary,
} from "../shared/bot-runner";

export interface ApprovalSession {
  tracker: ActionTracker;
  executor: ToolExecutor;
  pending: ActionLog[];
}

export const approvalSessions = new Map<number, ApprovalSession>();

export function approvalDiff(pending: ActionLog[]): string {
  return formatApprovalDiff(pending, 1500);
}

async function promptApproval(
  ctx: {
    reply: (t: string, o?: object) => Promise<unknown>;
  },
  chatId: number,
  session: ApprovalSession,
) {
  approvalSessions.set(chatId, session);

  await ctx.reply(formatApprovalSummary(session.pending), {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("📄 Show Diff", "approval_diff")],
      [
        Markup.button.callback("✅ Accept All", "approval_accept"),
        Markup.button.callback("❌ Reject All", "approval_reject"),
      ],
    ]),
  });
}

export async function finishOrApprove(
  ctx: {
    reply: (t: string, o?: object) => Promise<unknown>;
  },
  chatId: number,
  tracker: ActionTracker,
  executor: ToolExecutor,
  noChangesMsg: string,
) {
  const pending = tracker.getPendingMutations();

  if (pending.length === 0) {
    await ctx.reply(noChangesMsg);
    return;
  }

  await promptApproval(ctx, chatId, {
    tracker,
    executor,
    pending,
  });
}
