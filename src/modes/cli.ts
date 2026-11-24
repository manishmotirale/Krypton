import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import { runAgentMode } from "./agent/orchestrator";
import { runAskMode } from "./ask/orchestrator";
import { runPlanMode } from "./plan/orchestrator";
import { runModelSwitchCli, runUndoCli } from "./doctor";
import { getActiveModelId } from "../config/env";
import { withErrorHandling } from "../lib/error-handler";

export async function runCliMode() {
  while (true) {
    const mode = await select({
      message: `AI Mode (model: ${getActiveModelId()}) — choose a workflow:`,
      options: [
        {
          value: "agent",
          label: "🤖 Agent Mode",
          hint: "Automate tasks, files & commands with approval",
        },
        {
          value: "plan",
          label: "📋 Plan Mode",
          hint: "Break any goal into executable steps",
        },
        {
          value: "ask",
          label: "💬 Ask Mode",
          hint: "Chat, research, write, or inspect files (read-only)",
        },
        {
          value: "model",
          label: "🧠 Switch AI Model",
          hint: getActiveModelId(),
        },
        {
          value: "undo",
          label: "↩️  Undo Last Changes",
          hint: "Revert last applied batch",
        },
        { value: "back", label: "← Back to Main Menu" },
      ],
    });

    if (isCancel(mode) || mode === "back") return;

    if (mode === "agent") {
      await withErrorHandling(() => runAgentMode(), "Agent Mode");
    } else if (mode === "plan") {
      await withErrorHandling(() => runPlanMode(), "Plan Mode");
    } else if (mode === "ask") {
      await withErrorHandling(() => runAskMode(), "Ask Mode");
    } else if (mode === "model") {
      await withErrorHandling(() => runModelSwitchCli(), "Model Switch");
    } else if (mode === "undo") {
      await withErrorHandling(() => runUndoCli(), "Undo");
    } else {
      console.log(chalk.red("Invalid mode selected. Please choose again."));
    }
  }
}
