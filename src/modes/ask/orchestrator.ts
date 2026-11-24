import chalk from "chalk";
import { confirm, isCancel, spinner, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../core/ai/ai.config";
import { getActiveModelId, hasFirecrawlConfig } from "../../config/env";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { defaultAgentConfig } from "../agent/types";
import { createReadOnlyTools } from "../agent/read-only-tools";
import { renderTerminalMarkdown } from "../../ui/terminal-md";
import { printApplyResult, runApprovalFlow } from "../agent/approval";
import { createWebTools } from "../plan/web-tools";

interface QaTurn {
  question: string;
  answer: string;
}

function formatTranscriptMd(turns: QaTurn[]): string {
  const sections = turns.map(
    (t, idx) =>
      `## ${turns.length > 1 ? `Q${idx + 1}: ` : "Question"}\n\n${t.question.trim()}\n\n### Answer\n\n${t.answer.trim()}`,
  );
  return `# KRYPTON Ask Session\n\n${sections.join("\n\n---\n\n")}\n`;
}

function buildConversationPrompt(history: QaTurn[], currentQuestion: string): string {
  if (history.length === 0) return currentQuestion;

  const prior = history
    .slice(-6)
    .map(
      (turn, i) =>
        `Previous Q${i + 1}: ${turn.question}\nPrevious A${i + 1}: ${turn.answer.slice(0, 1500)}`,
    )
    .join("\n\n");

  return `Conversation context so far:\n${prior}\n\nFollow-up question:\n${currentQuestion}`;
}

export async function runAskMode(initialQuestion?: string) {
  console.log(
    chalk.bold.blueBright(`\n🔍 Ask Mode`) +
      chalk.dim(
        ` (read-only | model: ${getActiveModelId()} | type "exit" to finish)\n`,
      ),
  );

  const config = defaultAgentConfig();
  config.tools.allowFileCreation = true; // only used if user explicitly chooses to save .md
  config.tools.allowFileModification = false;
  config.tools.allowFolderCreation = false;
  config.tools.allowShellExecution = false;

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createReadOnlyTools(executor),
    ...(hasFirecrawlConfig() ? createWebTools(tracker) : {}),
  };

  const agent = new ToolLoopAgent({
    model: getAgentModel(),
    stopWhen: stepCountIs(20),
    instructions: [
      "You are KRYPTON, an all-in-one personal AI assistant in read-only Ask Mode.",
      "Help with anything the user asks: general questions, writing, research, brainstorming, web search, or inspecting local files/projects.",
      `Local workspace root (use file/git tools only when relevant): ${config.codebasePath}`,
    ].join("\n"),
    tools,
  });

  const turns: QaTurn[] = [];
  let pendingQuestion = initialQuestion?.trim() || "";
  const isOneShot = Boolean(pendingQuestion);

  while (true) {
    let question = pendingQuestion;
    pendingQuestion = "";

    if (!question) {
      const input = await text({
        message:
          turns.length === 0
            ? "What would you like to ask KRYPTON?"
            : 'Follow-up question (or press Enter / type "exit" to finish):',
        placeholder: turns.length === 0 ? "Ask anything — general Q&A, research, writing, or files..." : "",
      });

      if (isCancel(input)) break;
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "/exit") {
        break;
      }
      question = trimmed;
    }

    const spin = spinner();
    spin.start("Inspecting codebase and generating answer...");

    let answer = "";
    try {
      const result = await agent.generate({
        prompt: buildConversationPrompt(turns, question),
        onStepFinish: ({ toolCalls }) => {
          const names = toolCalls
            .filter((c): c is NonNullable<typeof c> => Boolean(c))
            .map((c) => c.toolName)
            .join(", ");
          if (names) {
            spin.message(`Running tools: ${names}...`);
          }
        },
      });
      answer = result.text?.trim() || "(no answer)";
      spin.stop("Answer ready.");
    } catch (error) {
      spin.stop("Failed to generate answer.");
      throw error;
    }

    turns.push({ question, answer });

    console.log(chalk.bold.greenBright("\nAgent Answer:\n"));
    console.log(renderTerminalMarkdown(answer) + "\n");

    if (isOneShot) break;
  }

  if (turns.length === 0) return;

  const wantsSave = await confirm({
    message: "Save this Q&A session to a .md file in the current directory?",
    initialValue: false,
  });

  if (isCancel(wantsSave) || !wantsSave) return;

  const filename = await text({
    message: "What filename should we use?",
    initialValue: "ask.md",
    validate: (value) => {
      const s = (value ?? "").trim();
      if (!s) return "Filename cannot be empty.";
      if (s.includes("..") || s.includes("/") || s.includes("\\")) {
        return "Provide a plain filename without directory separators.";
      }
      if (!s.toLowerCase().endsWith(".md")) {
        return "Filename must end with .md";
      }
    },
  });

  if (isCancel(filename) || !filename.trim()) return;

  executor.createFile(filename.trim(), formatTranscriptMd(turns));

  const ok = await runApprovalFlow(tracker);
  if (!ok) {
    executor.clearStaging();
    return;
  }

  const applyResult = executor.applyApprovedFromTracker();
  printApplyResult(applyResult);
  executor.clearStaging();
}
