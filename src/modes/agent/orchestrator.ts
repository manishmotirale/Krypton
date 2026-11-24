import { text, isCancel, spinner } from "@clack/prompts";
import chalk from "chalk";
import { stepCountIs, ToolLoopAgent } from "ai";
import { defaultAgentConfig } from "./types";
import { ActionTracker } from "./action-tracker";
import { ToolExecutor } from "./tool-executor";
import { createAgentTools } from "./agent-tools";
import { getAgentModel } from "../../core/ai/ai.config";
import { getActiveModelId, hasFirecrawlConfig } from "../../config/env";
import { renderTerminalMarkdown } from "../../ui/terminal-md";
import { printApplyResult, runApprovalFlow } from "./approval";
import { createWebTools } from "../plan/web-tools";

export async function runAgentMode(initialGoal?: string) {
  console.log(
    chalk.bold.cyan(`\n🤖 Agent Mode`) +
      chalk.dim(` (model: ${getActiveModelId()})\n`),
  );

  let goal = initialGoal?.trim() ?? "";
  if (!goal) {
    const input = await text({
      message: "What would you like to do?",
      placeholder: "Enter your task or coding goal...",
    });

    if (isCancel(input) || !input.trim()) return;
    goal = input.trim();
  }

  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const tools = {
    ...createAgentTools(executor),
    ...(hasFirecrawlConfig() ? createWebTools(tracker) : {}),
  };

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(40),
    instructions: [
      "You are KRYPTON, an all-in-one personal AI assistant and automation agent.",
      `Workspace root: ${config.codebasePath}`,
      "You can help with documents, notes, research, automation scripts, folder organization, shell commands, and code.",
      "All file mutations and shell commands are staged until explicit user approval.",
      "Prefer edit_file over modify_file for targeted changes to existing files.",
    ].join("\n"),
    tools,
  });

  const spin = spinner();
  spin.start("Agent is analyzing the codebase and preparing changes...");

  let result;
  try {
    result = await agent.generate({
      prompt: goal,
      onStepFinish: ({ toolCalls }) => {
        if (toolCalls.length > 0) {
          spin.stop("Tool activity:");
          for (const call of toolCalls) {
            if (!call) continue;
            const preview = JSON.stringify(call.input).slice(0, 140);
            console.log(
              chalk.green("  ✓"),
              chalk.bold(call.toolName),
              chalk.dim(preview + (preview.length >= 140 ? "..." : "")),
            );
          }
          spin.start("Agent is thinking...");
        }
      },
    });
    spin.stop("Agent finished.");
  } catch (error) {
    spin.stop("Agent failed.");
    executor.clearStaging();
    throw error;
  }

  if (result.text?.trim()) {
    console.log("\n" + renderTerminalMarkdown(result.text));
  }

  const ok = await runApprovalFlow(tracker);
  if (!ok) {
    executor.clearStaging();
    return;
  }

  const applyResult = executor.applyApprovedFromTracker();
  printApplyResult(applyResult);
  executor.clearStaging();
}
