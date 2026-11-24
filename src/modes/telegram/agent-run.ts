import type { Plan, PlanStep } from "../plan/types";
import {
  executeAgentTask,
  executeAskQuery,
  executePlanStepsTask,
} from "../shared/bot-runner";
import { replyMd } from "./text";
import { finishOrApprove } from "./approval-session";

export async function runAsk(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  question: string,
) {
  const answer = await executeAskQuery(question);
  await replyMd(ctx, answer);
}

export async function runAgent(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  chatId: number,
  goal: string,
) {
  const { text, tracker, executor } = await executeAgentTask(goal);

  if (text) {
    await replyMd(ctx, text);
  }

  await finishOrApprove(
    ctx,
    chatId,
    tracker,
    executor,
    "✅ Done. No file changes were needed.",
  );
}

export async function runPlanSteps(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  chatId: number,
  plan: Plan,
  steps: PlanStep[],
) {
  const { tracker, executor } = await executePlanStepsTask(
    plan,
    steps,
    async (event) => {
      if (event.type === "start") {
        await replyMd(
          ctx,
          `🔧 Executing (${event.index + 1}/${event.total}): *${event.step.title}*`,
        );
      } else if (event.type === "result" && event.text) {
        await replyMd(ctx, event.text);
      }
    },
  );

  await finishOrApprove(
    ctx,
    chatId,
    tracker,
    executor,
    "✅ All steps done. No file changes were needed.",
  );
}
