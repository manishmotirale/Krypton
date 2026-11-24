import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../core/ai/ai.config";
import {
  getActiveModelId,
  hasFirecrawlConfig,
  hasTelegramConfig,
} from "../../config/env";
import { APP_VERSION } from "../../lib/version";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { createAgentTools } from "../agent/agent-tools";
import { createReadOnlyTools } from "../agent/read-only-tools";
import {
  defaultAgentConfig,
  type ActionLog,
  type AgentConfig,
  type ApplyResult,
} from "../agent/types";
import { composeBeforeAfter, formatPatch } from "../agent/diff-view";
import { UndoManager } from "../agent/undo-manager";
import { createWebTools } from "../plan/web-tools";
import type { Plan, PlanStep } from "../plan/types";

function createReadOnlyConfig(): AgentConfig {
  const c = defaultAgentConfig();
  c.tools.allowFileCreation = false;
  c.tools.allowFileModification = false;
  c.tools.allowFolderCreation = false;
  c.tools.allowShellExecution = false;
  return c;
}

function extraWebTools(tracker: ActionTracker) {
  return hasFirecrawlConfig() ? createWebTools(tracker) : {};
}

export function splitMessage(text: string, maxLen = 3800): string[] {
  const clean = text.trim();
  if (!clean) return [""];
  if (clean.length <= maxLen) return [clean];

  const chunks: string[] = [];
  let remaining = clean;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < Math.floor(maxLen * 0.4)) {
      splitAt = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitAt <= 0) {
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function clipText(text: string, max = 3800): string {
  return text.length <= max ? text : text.slice(0, max) + "\n…[truncated]";
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function groupPendingMutations(pending: ActionLog[]) {
  const files = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === "tool_execute") {
      shells.push(a);
    } else {
      if (!files.has(a.path)) files.set(a.path, []);
      files.get(a.path)!.push(a);
    }
  }

  return { files, shells };
}

export function formatApprovalSummary(pending: ActionLog[]): string {
  const { files, shells } = groupPendingMutations(pending);

  const fileLines = [...files.entries()].map(([filePath, actions]) => {
    const types = [
      ...new Set(actions.map((a) => a.type.replace(/_/g, " "))),
    ].join(", ");
    return `📄 ${filePath} (${types})`;
  });

  const shellLines = shells.map((s) => `💻 Shell: ${s.details.command}`);

  return [
    "📦 Staged changes — review before applying:",
    "",
    ...fileLines,
    ...shellLines,
    "",
    `Total: ${pending.length} staged operation(s).`,
  ].join("\n");
}

export function formatApprovalDiff(pending: ActionLog[], maxPerFile = 1800): string {
  const { files, shells } = groupPendingMutations(pending);
  const parts: string[] = [];

  for (const [filePath, actions] of files.entries()) {
    const sorted = [...actions].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );

    if (sorted.every((a) => a.type === "folder_create")) {
      parts.push(`📁 Create folder: ${filePath}`);
      continue;
    }

    const { before, after } = composeBeforeAfter(sorted);
    parts.push(clipText(formatPatch(filePath, before, after), maxPerFile));
  }

  for (const s of shells) {
    parts.push(`💻 Shell: ${s.details.command}`);
  }

  return parts.join("\n\n").trim() || "(no diff available)";
}

export function formatApplySummary(result: ApplyResult): string {
  const lines: string[] = [];

  if (result.errors.length === 0) {
    lines.push(`✅ Applied ${result.appliedCount} operation(s) successfully.`);
  } else {
    lines.push(
      `⚠️ Applied ${result.appliedCount} operation(s) with ${result.errors.length} error(s):`,
    );
    for (const err of result.errors) {
      lines.push(`• ${err}`);
    }
  }

  for (const out of result.outputs) {
    lines.push("", `💻 $ ${out.command} (exit ${out.exitCode ?? "?"})`);
    if (out.stdout) {
      lines.push(clipText(out.stdout, 1000));
    }
    if (out.stderr) {
      lines.push(`stderr: ${clipText(out.stderr, 500)}`);
    }
  }

  if (result.undoBatchId) {
    lines.push("", "↩️ Send /undo to revert these file changes.");
  }

  return lines.join("\n");
}

export async function executeAskQuery(question: string): Promise<string> {
  const config = createReadOnlyConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createReadOnlyTools(executor),
    ...extraWebTools(tracker),
  };

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(20),
    instructions: [
      "You are KRYPTON, an all-in-one personal AI assistant and automation companion.",
      "You help with anything the user asks: general questions, writing, brainstorming, research, web search, summaries, productivity, files, notes, and coding.",
      `Local workspace root (if the user asks about local files or projects): ${config.codebasePath}`,
      "Only call file/git tools when the question relates to local files or the workspace; for general questions or web research, answer directly or use web tools if available.",
    ].join("\n"),
    tools,
  });

  const { text } = await agent.generate({ prompt: question });
  return text?.trim() || "(no answer)";
}

export interface AgentTaskRunResult {
  text: string;
  tracker: ActionTracker;
  executor: ToolExecutor;
  pending: ActionLog[];
}

export async function executeAgentTask(goal: string): Promise<AgentTaskRunResult> {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createAgentTools(executor),
    ...extraWebTools(tracker),
  };

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: [
      "You are KRYPTON, an all-in-one personal AI assistant and automation agent.",
      `Workspace root: ${config.codebasePath}`,
      "You can create or edit any files (notes, documents, scripts, configs, code), organize folders, search the web, and queue shell automation commands.",
      "All file mutations and shell commands are staged until explicit user approval.",
      "Prefer edit_file over modify_file for targeted edits to existing files.",
    ].join("\n"),
    tools,
  });

  const { text } = await agent.generate({ prompt: goal });
  return {
    text: text?.trim() || "",
    tracker,
    executor,
    pending: tracker.getPendingMutations(),
  };
}

export async function executePlanStepsTask(
  plan: Plan,
  steps: PlanStep[],
  onStepProgress?: (
    event:
      | { type: "start"; step: PlanStep; index: number; total: number }
      | { type: "result"; step: PlanStep; text: string },
  ) => Promise<void> | void,
): Promise<AgentTaskRunResult> {
  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createAgentTools(executor),
    ...extraWebTools(tracker),
  };

  const summaries: string[] = [];

  for (const [idx, step] of steps.entries()) {
    await onStepProgress?.({
      type: "start",
      step,
      index: idx,
      total: steps.length,
    });

    const hints = step.hints?.length
      ? `\nHints:\n- ${step.hints.join("\n- ")}`
      : "";
    const prompt = [
      `Goal: ${plan.goal}`,
      `Step ${idx + 1}/${steps.length}: ${step.title}`,
      step.description,
      hints,
    ]
      .filter(Boolean)
      .join("\n");

    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(30),
      instructions: [
        `Workspace root: ${config.codebasePath}`,
        "All mutations are staged until final user approval.",
        "Prefer edit_file over modify_file for targeted edits.",
      ].join("\n"),
      tools,
    });

    const { text } = await agent.generate({ prompt });
    const cleanText = text?.trim() || "";
    if (cleanText) {
      summaries.push(cleanText);
      await onStepProgress?.({ type: "result", step, text: cleanText });
    }
  }

  return {
    text: summaries.join("\n\n"),
    tracker,
    executor,
    pending: tracker.getPendingMutations(),
  };
}

export function getGitQuickSummary(): string {
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, createReadOnlyConfig());
  const status = executor.gitStatus();
  const log = executor.gitLog(5);

  return [
    "🌿 Git Status:",
    status,
    "",
    "📜 Recent Commits:",
    log,
  ].join("\n");
}

export function runUndoCommand(): string {
  const undoManager = new UndoManager(process.cwd());
  const result = undoManager.undoLastBatch();
  if (!result.success && result.errors.length === 0) {
    return `ℹ️ ${result.message}`;
  }

  const lines = [
    result.success ? `↩️ ${result.message}` : `⚠️ ${result.message}`,
  ];
  if (result.restored.length) {
    lines.push("Restored: " + result.restored.join(", "));
  }
  if (result.removed.length) {
    lines.push("Removed: " + result.removed.join(", "));
  }
  if (result.errors.length) {
    lines.push("Errors:\n" + result.errors.map((e) => `• ${e}`).join("\n"));
  }
  return lines.join("\n");
}

export function getBotStatusReport(
  platform: string,
  sessionInfo: { hasPlan: boolean; hasApproval: boolean },
): string {
  const undoCount = new UndoManager(process.cwd()).listHistory().length;
  return [
    `🚀 KRYPTON v${APP_VERSION} (${platform})`,
    `• Workspace: ${process.cwd()}`,
    `• Model: ${getActiveModelId()}`,
    `• Web Tools (Firecrawl): ${hasFirecrawlConfig() ? "Enabled" : "Disabled"}`,
    `• Telegram Config: ${hasTelegramConfig() ? "Configured" : "Not configured"}`,
    `• Undo Snapshots Available: ${undoCount}`,
    `• Active Plan Session: ${sessionInfo.hasPlan ? "Yes" : "No"}`,
    `• Pending Approval: ${sessionInfo.hasApproval ? "Yes" : "No"}`,
  ].join("\n");
}
