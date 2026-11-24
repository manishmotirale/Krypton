import chalk from "chalk";
import { confirm, isCancel, spinner, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../core/ai/ai.config";
import { getActiveModelId, hasFirecrawlConfig } from "../../config/env";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { createAgentTools } from "../agent/agent-tools";
import { defaultAgentConfig } from "../agent/types";
import { printApplyResult, runApprovalFlow } from "../agent/approval";
import { renderTerminalMarkdown } from "../../ui/terminal-md";
import { generatePlan } from "./planner";
import { printPlan, selectSteps } from "./selection";
import type { PlanStep } from "./types";
import { createWebTools } from "./web-tools";

function stepPrompt(goal: string, step: PlanStep, index: number, total: number): string {
  const hints = step.hints?.length ? `\nHints:\n- ${step.hints.join("\n- ")}` : "";
  return [
    `Overall Goal: ${goal}`,
    `Executing Step ${index + 1} of ${total}: ${step.title}`,
    step.description,
    hints,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runPlanMode(initialGoal?: string): Promise<void> {
  console.log(
    chalk.bold.blueBright(`\n📋 Plan Mode`) +
      chalk.dim(` (model: ${getActiveModelId()})\n`),
  );

  let goal = initialGoal?.trim() ?? "";
  if (!goal) {
    const input = await text({
      message: "What is the goal of this plan?",
      placeholder: "e.g. Add unit tests for auth middleware",
    });

    if (isCancel(input) || !input.trim()) {
      return;
    }
    goal = input.trim();
  }

  const plan = await generatePlan(goal);

  printPlan(plan);

  const selected = await selectSteps(plan);
  if (selected.length === 0) {
    console.log(chalk.dim("No steps selected. Returning to menu.\n"));
    return;
  }

  const proceed = await confirm({
    message: `Execute ${selected.length} selected step(s)?`,
    initialValue: true,
  });

  if (isCancel(proceed) || !proceed) {
    console.log(chalk.yellow("\nPlan execution cancelled.\n"));
    return;
  }

  const config = defaultAgentConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createAgentTools(executor),
    ...(hasFirecrawlConfig() ? createWebTools(tracker) : {}),
  };

  for (const [idx, step] of selected.entries()) {
    console.log(
      chalk.bold.cyan(
        `\n▶ Step ${idx + 1}/${selected.length}: ${step.title}\n`,
      ),
    );

    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(30),
      instructions: [
        `Workspace root: ${config.codebasePath}`,
        "All mutations are staged until approval at the end of the plan.",
        "Prefer edit_file over modify_file for targeted edits.",
      ].join("\n"),
      tools,
    });

    const spin = spinner();
    spin.start(`Running step: ${step.title}...`);

    try {
      const res = await agent.generate({
        prompt: stepPrompt(plan.goal, step, idx, selected.length),
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
            spin.start(`Continuing step: ${step.title}...`);
          }
        },
      });
      spin.stop(`Step ${idx + 1} completed.`);

      if (res.text?.trim()) {
        console.log("\n" + renderTerminalMarkdown(res.text));
      }
    } catch (error) {
      spin.stop(`Step ${idx + 1} failed.`);
      executor.clearStaging();
      throw error;
    }
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
