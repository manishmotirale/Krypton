import {
  Output,
  extractJsonMiddleware,
  generateText,
  stepCountIs,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";
import { spinner } from "@clack/prompts";

import { getAgentModel } from "../../core/ai/ai.config";
import { hasFirecrawlConfig } from "../../config/env";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { defaultAgentConfig } from "../agent/types";
import { createReadOnlyTools } from "../agent/read-only-tools";
import type { Plan, PlanStep } from "./types";
import { createWebTools } from "./web-tools";

const planSchema = z.object({
  researchSummary: z.string().optional(),
  steps: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        hints: z.array(z.string()).optional(),
        complexity: z.enum(["low", "medium", "high"]).optional(),
      }),
    )
    .min(1)
    .max(15),
});

const PLAN_INSTRUCTIONS = (codebase: string, hasWeb: boolean) =>
  [
    "You are KRYPTON's Plan-Mode strategist. You break any user goal (personal, workflow, research, automation, document, or engineering) into clear executable steps. You DO NOT modify files directly.",
    `Local workspace: ${codebase}`,
    "Use read-only tools if the goal involves local files, projects, or skills.",
    hasWeb
      ? "Web tools are available (web_search/web_crawl). Use when external research or live info helps."
      : "Web tools are unavailable (no FIRECRAWL_API_KEY configured).",
    "Output must strictly match the provided JSON schema.",
    "Keep steps focused, actionable, and ordered: 1-15 steps.",
  ].join("\n");

export async function generatePlan(
  goal: string,
  options?: { silent?: boolean },
): Promise<Plan> {
  const tracker = new ActionTracker();
  const config = defaultAgentConfig();
  const executor = new ToolExecutor(tracker, config);

  const hasWeb = hasFirecrawlConfig();
  const model = wrapLanguageModel({
    model: getAgentModel(),
    middleware: extractJsonMiddleware(),
  });

  const tools = {
    ...createReadOnlyTools(executor),
    ...(hasWeb ? createWebTools(tracker) : {}),
  };

  const spin = options?.silent ? null : spinner();
  spin?.start("Researching codebase and drafting implementation plan...");

  try {
    const result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(20),
      system: PLAN_INSTRUCTIONS(config.codebasePath, hasWeb),
      prompt: `User goal:\n${goal}`,
      output: Output.object({ schema: planSchema }),
    });

    spin?.stop("Implementation plan generated.");

    const validated = planSchema.parse(result.output);

    const steps: PlanStep[] = validated.steps.map((step, index) => ({
      id: `step-${index + 1}`,
      title: step.title,
      description: step.description,
      hints: step.hints,
      complexity: step.complexity,
    }));

    return { goal, researchSummary: validated.researchSummary, steps };
  } catch (error) {
    spin?.stop("Plan generation failed.");
    throw error;
  }
}
