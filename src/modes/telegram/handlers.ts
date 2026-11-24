import type { Telegraf } from "telegraf";
import { isOwner } from "./auth";
import { WELCOME } from "./constants";
import { commandArg, replyMd } from "./text";
import { runAgent, runAsk, runPlanSteps } from "./agent-run";
import { generatePlan } from "../plan/planner";
import {
  planKeyboard,
  planMessage,
  planSessions,
  refreshPlanUi,
  type PlanSession,
} from "./plan-session";
import { approvalDiff, approvalSessions } from "./approval-session";
import {
  formatApplySummary,
  formatErrorMessage,
  getBotStatusReport,
  getGitQuickSummary,
  runUndoCommand,
  splitMessage,
} from "../shared/bot-runner";
import { getActiveModelId, setActiveModelId } from "../../config/env";

export function registerHandlers(bot: Telegraf) {
  const sendWelcome = async (ctx: {
    chat?: { id: number };
    reply: (t: string, o?: object) => Promise<unknown>;
  }) => {
    if (!isOwner(ctx.chat?.id)) {
      return ctx.reply("⛔ You are not authorized to use this bot.");
    }
    await replyMd(ctx, WELCOME);
  };

  bot.command("start", sendWelcome);
  bot.command("help", sendWelcome);

  bot.command("status", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    const report = getBotStatusReport("Telegram Bot", {
      hasPlan: planSessions.has(ctx.chat.id),
      hasApproval: approvalSessions.has(ctx.chat.id),
    });
    await ctx.reply(report);
  });

  bot.command("git", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    await ctx.reply(getGitQuickSummary());
  });

  bot.command("undo", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    await ctx.reply(runUndoCommand());
  });

  bot.command("model", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    const arg = commandArg(ctx.message.text, "model");
    if (!arg) {
      return replyMd(
        ctx,
        `🧠 Current model: \`${getActiveModelId()}\`\n\nUsage: \`/model <openrouter_model_id>\` or \`/model reset\``,
      );
    }

    if (arg.toLowerCase() === "reset") {
      setActiveModelId(null);
      return replyMd(
        ctx,
        `🔄 Model reset to default: \`${getActiveModelId()}\``,
      );
    }

    setActiveModelId(arg);
    return replyMd(ctx, `✅ Active AI model switched to: \`${arg}\``);
  });

  bot.command("cancel", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    const hadPlan = planSessions.delete(ctx.chat.id);
    const approval = approvalSessions.get(ctx.chat.id);
    if (approval) {
      approval.executor.clearStaging();
      approvalSessions.delete(ctx.chat.id);
    }

    if (hadPlan || approval) {
      await ctx.reply("🚫 Active session cancelled and staged changes cleared.");
    } else {
      await ctx.reply("ℹ️ No active plan or approval session to cancel.");
    }
  });

  bot.command("ask", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;

    const q = commandArg(ctx.message.text, "ask");
    if (!q) {
      return replyMd(ctx, "Usage: `/ask <your question>`");
    }

    await ctx.reply("🔍 Analyzing codebase and thinking...");
    void runAsk(ctx, q).catch(async (err) => {
      console.error("[Telegram /ask error]", err);
      await ctx.reply(`❌ Ask failed: ${formatErrorMessage(err)}`);
    });
  });

  bot.command("agent", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;

    const goal = commandArg(ctx.message.text, "agent");
    if (!goal) {
      return replyMd(ctx, "Usage: `/agent <task description>`");
    }

    await ctx.reply("🤖 Agent is working on your task...");

    void runAgent(ctx, ctx.chat.id, goal).catch(async (err) => {
      console.error("[Telegram /agent error]", err);
      await ctx.reply(`❌ Agent failed: ${formatErrorMessage(err)}`);
    });
  });

  bot.command("plan", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;

    const goal = commandArg(ctx.message.text, "plan");
    if (!goal) {
      return replyMd(ctx, "Usage: `/plan <your goal>`");
    }

    await ctx.reply("📋 Researching codebase and drafting a plan...");

    void (async () => {
      const plan = await generatePlan(goal, { silent: true });
      const session: PlanSession = {
        plan,
        selected: new Set(plan.steps.map((s) => s.id)),
      };

      planSessions.set(ctx.chat.id, session);
      try {
        await ctx.reply(planMessage(session), {
          parse_mode: "Markdown",
          ...planKeyboard(session),
        });
      } catch {
        await ctx.reply(planMessage(session), {
          ...planKeyboard(session),
        });
      }
    })().catch(async (err) => {
      console.error("[Telegram /plan error]", err);
      await ctx.reply(`❌ Plan generation failed: ${formatErrorMessage(err)}`);
    });
  });

  // Fixed regex: callback data is "plan_toggle:<id>" (no leading slash)
  bot.action(/^plan_toggle:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const chatId = ctx.chat!.id;
    const s = planSessions.get(chatId);
    if (!s) return ctx.answerCbQuery("Plan session expired.");

    const id = ctx.match[1]!;

    if (s.selected.has(id)) {
      s.selected.delete(id);
    } else {
      s.selected.add(id);
    }

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  bot.action("plan_all", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("Plan session expired.");

    for (const step of s.plan.steps) {
      s.selected.add(step.id);
    }

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery("All selected");
  });

  bot.action("plan_none", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("Plan session expired.");

    s.selected.clear();

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery("All deselected");
  });

  bot.action("plan_proceed", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const chatId = ctx.chat!.id;
    const s = planSessions.get(chatId);
    if (!s) return ctx.answerCbQuery("Plan session expired.");

    const steps = s.plan.steps.filter((step) => s.selected.has(step.id));

    if (steps.length === 0) {
      return ctx.answerCbQuery("Select at least one step first.");
    }

    const { plan } = s;
    planSessions.delete(chatId);

    const list = steps.map((step, i) => `${i + 1}. ${step.title}`).join("\n");

    await ctx.editMessageText(
      `🚀 Executing ${steps.length} step(s)...\n\n${list}`,
    );

    await ctx.answerCbQuery("Starting execution...");

    void runPlanSteps(ctx, chatId, plan, steps).catch(async (err) => {
      console.error("[Telegram plan execution error]", err);
      await ctx.reply(`❌ Plan execution failed: ${formatErrorMessage(err)}`);
    });
  });

  bot.action("approval_diff", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery("Approval session expired.");

    await ctx.answerCbQuery();
    const diffChunks = splitMessage(approvalDiff(s.pending), 3800);
    for (const chunk of diffChunks) {
      await ctx.reply(chunk);
    }
  });

  bot.action("approval_accept", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const chatId = ctx.chat!.id;
    const s = approvalSessions.get(chatId);
    if (!s) return ctx.answerCbQuery("Approval session expired.");

    approvalSessions.delete(chatId);

    for (const a of s.pending) {
      s.tracker.updateStatus(a.id, "approved", true);
    }

    const applyResult = s.executor.applyApprovedFromTracker();
    s.executor.clearStaging();

    const summary = formatApplySummary(applyResult);
    await ctx.editMessageText(summary.slice(0, 4000));
    await ctx.answerCbQuery(
      applyResult.errors.length ? "Applied with errors" : "Applied!",
    );

    if (applyResult.errors.length) {
      console.error("[Telegram apply errors]", applyResult.errors);
    }
  });

  bot.action("approval_reject", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return ctx.answerCbQuery();

    const chatId = ctx.chat!.id;
    const s = approvalSessions.get(chatId);
    if (!s) return ctx.answerCbQuery("Approval session expired.");

    approvalSessions.delete(chatId);

    for (const a of s.pending) {
      s.tracker.updateStatus(a.id, "rejected", false);
    }

    s.executor.clearStaging();

    await ctx.editMessageText(
      "❌ All changes rejected. Nothing was applied.",
    );
    await ctx.answerCbQuery("Rejected");
  });

  // Natural chat: any plain text message (non-command) from the owner is answered directly!
  bot.on("text", async (ctx) => {
    if (!isOwner(ctx.chat?.id)) return;
    const text = ctx.message.text?.trim();
    if (!text || text.startsWith("/")) return;

    await ctx.reply("💭 Thinking...");
    void runAsk(ctx, text).catch(async (err) => {
      console.error("[Telegram chat error]", err);
      await ctx.reply(`❌ Failed: ${formatErrorMessage(err)}`);
    });
  });
}
