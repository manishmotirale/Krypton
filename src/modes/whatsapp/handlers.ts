import { getActiveModelId, setActiveModelId } from "../../config/env";
import { generatePlan } from "../plan/planner";
import {
  executeAgentTask,
  executeAskQuery,
  executePlanStepsTask,
  formatApplySummary,
  formatApprovalDiff,
  formatErrorMessage,
  getBotStatusReport,
  getGitQuickSummary,
  runUndoCommand,
  splitMessage,
} from "../shared/bot-runner";
import { WA_WELCOME } from "./constants";
import {
  formatWhatsAppApproval,
  formatWhatsAppPlan,
  parseStepNumbers,
  waApprovalSessions,
  waBusyChats,
  waPlanSessions,
} from "./session";
import { markdownToWhatsApp, parseWhatsAppCommand } from "./text";

export interface WhatsAppClientAdapter {
  sendText: (jid: string, text: string) => Promise<void>;
  setTyping?: (jid: string, typing: boolean) => Promise<void>;
}

async function sendChunked(
  client: WhatsAppClientAdapter,
  jid: string,
  text: string,
  formatMarkdown = false,
): Promise<void> {
  const prepared = formatMarkdown ? markdownToWhatsApp(text) : text;
  const chunks = splitMessage(prepared, 3500);
  for (const chunk of chunks) {
    await client.sendText(jid, chunk);
  }
}

export interface WhatsAppHandleOptions {
  /** When true (e.g. inside a dedicated bound KRYPTON chat), plain messages without `/` are answered directly! */
  isDedicatedChat?: boolean;
}

export async function handleWhatsAppMessage(
  client: WhatsAppClientAdapter,
  jid: string,
  rawText: string,
  options: WhatsAppHandleOptions = {},
): Promise<void> {
  const trimmed = rawText.trim();
  if (!trimmed) return;

  const { command, arg, hasPrefix } = parseWhatsAppCommand(trimmed);
  const hasApproval = waApprovalSessions.has(jid);
  const hasPlan = waPlanSessions.has(jid);

  // Check if this is a bare session reply (e.g. "approve", "toggle 1,2")
  const isApprovalReply =
    !hasPrefix &&
    hasApproval &&
    ["approve", "yes", "y", "accept", "reject", "no", "n", "diff"].includes(
      command,
    );
  const isPlanReply =
    !hasPrefix &&
    hasPlan &&
    ["toggle", "all", "none", "proceed", "run", "cancel"].includes(command);

  // If plain text without `/` or `!`:
  // - In a dedicated KRYPTON chat, answer directly as an AI assistant!
  // - In self-chat, ignore casual notes so we don't reply to personal reminders.
  if (!hasPrefix && !isApprovalReply && !isPlanReply) {
    if (!options.isDedicatedChat) {
      return;
    }

    if (waBusyChats.has(jid)) {
      await sendChunked(client, jid, "⏳ Still working on your previous request. Please wait.");
      return;
    }

    waBusyChats.add(jid);
    try {
      await client.setTyping?.(jid, true);
      const answer = await executeAskQuery(trimmed);
      await sendChunked(client, jid, answer, true);
    } catch (err) {
      await sendChunked(client, jid, `❌ Request failed: ${formatErrorMessage(err)}`);
    } finally {
      waBusyChats.delete(jid);
      await client.setTyping?.(jid, false);
    }
    return;
  }

  // Help / Welcome
  if (command === "start" || command === "help" || command === "menu") {
    await sendChunked(client, jid, WA_WELCOME);
    return;
  }

  // Status
  if (command === "status") {
    const report = getBotStatusReport("WhatsApp Bot", {
      hasPlan,
      hasApproval,
    });
    await sendChunked(client, jid, report);
    return;
  }

  // Git quick summary
  if (command === "git") {
    await sendChunked(client, jid, getGitQuickSummary());
    return;
  }

  // Undo last applied batch
  if (command === "undo") {
    await sendChunked(client, jid, runUndoCommand());
    return;
  }

  // View or switch AI model
  if (command === "model") {
    if (!arg) {
      await sendChunked(
        client,
        jid,
        `🧠 *Current AI model:* \`${getActiveModelId()}\`\n\nUsage:\n• \`/model <openrouter_model_id>\`\n• \`/model reset\``,
      );
      return;
    }

    if (arg.toLowerCase() === "reset") {
      setActiveModelId(null);
      await sendChunked(
        client,
        jid,
        `🔄 Model reset to default: \`${getActiveModelId()}\``,
      );
      return;
    }

    setActiveModelId(arg);
    await sendChunked(client, jid, `✅ Active AI model switched to: \`${arg}\``);
    return;
  }

  // Cancel active session
  if (command === "cancel") {
    const clearedPlan = waPlanSessions.delete(jid);
    const approval = waApprovalSessions.get(jid);
    if (approval) {
      approval.executor.clearStaging();
      waApprovalSessions.delete(jid);
    }

    if (clearedPlan || approval) {
      await sendChunked(
        client,
        jid,
        "🚫 Active session cancelled and staged changes discarded.",
      );
    } else {
      await sendChunked(client, jid, "ℹ️ No active plan or approval session.");
    }
    return;
  }

  // Approval session commands
  if (command === "diff") {
    const session = waApprovalSessions.get(jid);
    if (!session) {
      await sendChunked(client, jid, "ℹ️ No pending changes awaiting approval.");
      return;
    }

    const diffText = formatApprovalDiff(session.pending, 1500);
    await sendChunked(client, jid, "```\n" + diffText + "\n```");
    return;
  }

  if (["approve", "accept", "yes", "y"].includes(command)) {
    const session = waApprovalSessions.get(jid);
    if (!session) {
      await sendChunked(client, jid, "ℹ️ No pending changes awaiting approval.");
      return;
    }

    waApprovalSessions.delete(jid);
    for (const a of session.pending) {
      session.tracker.updateStatus(a.id, "approved", true);
    }

    const result = session.executor.applyApprovedFromTracker();
    session.executor.clearStaging();

    await sendChunked(client, jid, formatApplySummary(result));
    return;
  }

  if (["reject", "no", "n"].includes(command)) {
    const session = waApprovalSessions.get(jid);
    if (!session) {
      await sendChunked(client, jid, "ℹ️ No pending changes awaiting approval.");
      return;
    }

    waApprovalSessions.delete(jid);
    for (const a of session.pending) {
      session.tracker.updateStatus(a.id, "rejected", false);
    }
    session.executor.clearStaging();

    await sendChunked(
      client,
      jid,
      "❌ All staged changes rejected. Nothing was written to disk.",
    );
    return;
  }

  // Plan session interactive controls
  if (command === "toggle") {
    const session = waPlanSessions.get(jid);
    if (!session) {
      await sendChunked(client, jid, "ℹ️ No active plan. Start one with `/plan <goal>`.");
      return;
    }

    const nums = parseStepNumbers(arg, session.plan.steps.length);
    if (nums.length === 0) {
      await sendChunked(
        client,
        jid,
        `Usage: \`toggle 1,3\` or \`toggle 2-4\` (valid range: 1-${session.plan.steps.length})`,
      );
      return;
    }

    for (const n of nums) {
      const step = session.plan.steps[n - 1];
      if (!step) continue;
      if (session.selected.has(step.id)) {
        session.selected.delete(step.id);
      } else {
        session.selected.add(step.id);
      }
    }

    await sendChunked(client, jid, formatWhatsAppPlan(session));
    return;
  }

  if (command === "all" && hasPlan) {
    const session = waPlanSessions.get(jid)!;
    for (const s of session.plan.steps) session.selected.add(s.id);
    await sendChunked(client, jid, formatWhatsAppPlan(session));
    return;
  }

  if (command === "none" && hasPlan) {
    const session = waPlanSessions.get(jid)!;
    session.selected.clear();
    await sendChunked(client, jid, formatWhatsAppPlan(session));
    return;
  }

  if (command === "proceed" || command === "run") {
    const session = waPlanSessions.get(jid);
    if (!session) {
      await sendChunked(client, jid, "ℹ️ No active plan. Start one with `/plan <goal>`.");
      return;
    }

    const steps = session.plan.steps.filter((s) => session.selected.has(s.id));
    if (steps.length === 0) {
      await sendChunked(client, jid, "⚠️ Select at least one step first (e.g. `all` or `toggle 1`).");
      return;
    }

    if (waBusyChats.has(jid)) {
      await sendChunked(client, jid, "⏳ Another task is currently running. Please wait.");
      return;
    }

    waPlanSessions.delete(jid);
    waBusyChats.add(jid);

    try {
      await client.setTyping?.(jid, true);
      await sendChunked(
        client,
        jid,
        `🚀 Executing ${steps.length} step(s)...\n\n` +
          steps.map((s, i) => `${i + 1}. ${s.title}`).join("\n"),
      );

      const { tracker, executor, pending } = await executePlanStepsTask(
        session.plan,
        steps,
        async (event) => {
          if (event.type === "start") {
            await sendChunked(
              client,
              jid,
              `🔧 Step ${event.index + 1}/${event.total}: *${event.step.title}*`,
            );
          } else if (event.type === "result" && event.text) {
            await sendChunked(client, jid, event.text, true);
          }
        },
      );

      if (pending.length === 0) {
        await sendChunked(client, jid, "✅ All steps completed. No file changes were needed.");
      } else {
        waApprovalSessions.set(jid, { tracker, executor, pending });
        await sendChunked(client, jid, formatWhatsAppApproval(pending));
      }
    } catch (err) {
      await sendChunked(
        client,
        jid,
        `❌ Plan execution failed: ${formatErrorMessage(err)}`,
      );
    } finally {
      waBusyChats.delete(jid);
      await client.setTyping?.(jid, false);
    }
    return;
  }

  // Long-running AI commands: /ask (or /chat), /agent, /plan
  if (command === "ask" || command === "chat") {
    if (!arg) {
      await sendChunked(client, jid, "Usage: `/ask <anything you want to ask>`");
      return;
    }
    if (waBusyChats.has(jid)) {
      await sendChunked(client, jid, "⏳ Still working on the previous request. Please wait.");
      return;
    }

    waBusyChats.add(jid);
    try {
      await client.setTyping?.(jid, true);
      await sendChunked(client, jid, "🔍 Thinking...");
      const answer = await executeAskQuery(arg);
      await sendChunked(client, jid, answer, true);
    } catch (err) {
      await sendChunked(client, jid, `❌ Ask failed: ${formatErrorMessage(err)}`);
    } finally {
      waBusyChats.delete(jid);
      await client.setTyping?.(jid, false);
    }
    return;
  }

  if (command === "agent") {
    if (!arg) {
      await sendChunked(client, jid, "Usage: `/agent <task description>`");
      return;
    }
    if (waBusyChats.has(jid)) {
      await sendChunked(client, jid, "⏳ Still working on the previous request. Please wait.");
      return;
    }

    waBusyChats.add(jid);
    try {
      await client.setTyping?.(jid, true);
      await sendChunked(client, jid, "🤖 Agent is working on your task...");
      const { text, tracker, executor, pending } = await executeAgentTask(arg);

      if (text) {
        await sendChunked(client, jid, text, true);
      }

      if (pending.length === 0) {
        await sendChunked(client, jid, "✅ Done. No file changes were needed.");
      } else {
        // Clear any superseded approval session
        const old = waApprovalSessions.get(jid);
        if (old) old.executor.clearStaging();

        waApprovalSessions.set(jid, { tracker, executor, pending });
        await sendChunked(client, jid, formatWhatsAppApproval(pending));
      }
    } catch (err) {
      await sendChunked(client, jid, `❌ Agent failed: ${formatErrorMessage(err)}`);
    } finally {
      waBusyChats.delete(jid);
      await client.setTyping?.(jid, false);
    }
    return;
  }

  if (command === "plan") {
    if (!arg) {
      await sendChunked(client, jid, "Usage: `/plan <your goal>`");
      return;
    }
    if (waBusyChats.has(jid)) {
      await sendChunked(client, jid, "⏳ Still working on the previous request. Please wait.");
      return;
    }

    waBusyChats.add(jid);
    try {
      await client.setTyping?.(jid, true);
      await sendChunked(client, jid, "📋 Researching codebase and drafting a plan...");
      const plan = await generatePlan(arg, { silent: true });
      const session = {
        plan,
        selected: new Set(plan.steps.map((s) => s.id)),
      };
      waPlanSessions.set(jid, session);
      await sendChunked(client, jid, formatWhatsAppPlan(session));
    } catch (err) {
      await sendChunked(
        client,
        jid,
        `❌ Plan generation failed: ${formatErrorMessage(err)}`,
      );
    } finally {
      waBusyChats.delete(jid);
      await client.setTyping?.(jid, false);
    }
    return;
  }

  if (hasPrefix) {
    await sendChunked(
      client,
      jid,
      `❓ Unknown command \`/${command}\`. Send \`/help\` to see available commands.`,
    );
  }
}
