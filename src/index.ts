#!/usr/bin/env bun

import { Command } from "commander";
import { getAppBaseDir, initLogLevel, loadEnvFiles } from "./config/env";
import { handleError, withErrorHandling } from "./lib/error-handler";
import { APP_NAME, APP_TAGLINE, APP_VERSION } from "./lib/version";
import { runAgentMode } from "./modes/agent/orchestrator";
import { runAskMode } from "./modes/ask/orchestrator";
import { runDoctor, runUndoCli } from "./modes/doctor";
import { runPlanMode } from "./modes/plan/orchestrator";
import { runTelegramMode } from "./modes/telegram";
import { runWhatsAppMode } from "./modes/whatsapp";
import { runWakeup } from "./ui/wakeup";

loadEnvFiles();
initLogLevel();

// When double-clicking dist\krypton.exe directly from Windows Explorer,
// switch working directory to the project root if .env lives right above dist\.
const baseDir = getAppBaseDir();
if (
  baseDir !== process.cwd() &&
  process.cwd().toLowerCase().startsWith(baseDir.toLowerCase())
) {
  try {
    process.chdir(baseDir);
  } catch {
    // ignore if unable to change directory
  }
}

const program = new Command();

program
  .name(APP_NAME.toLowerCase())
  .description(`${APP_NAME} — ${APP_TAGLINE}`)
  .version(APP_VERSION);

program
  .command("wakeup", { isDefault: true })
  .description("Show the banner and open the interactive mode selector")
  .action(async () => {
    await runWakeup({});
  });

program
  .command("start")
  .description("Quick start — alias for wakeup")
  .action(async () => {
    await runWakeup({});
  });

program
  .command("ask [question...]")
  .description("Run read-only Ask Mode (interactive or one-shot question)")
  .action(async (questionParts: string[]) => {
    const q = questionParts?.join(" ").trim() || undefined;
    await withErrorHandling(() => runAskMode(q), "Ask Mode");
  });

program
  .command("agent [goal...]")
  .description("Run Agent Mode to modify the codebase with diff approval")
  .action(async (goalParts: string[]) => {
    const goal = goalParts?.join(" ").trim() || undefined;
    await withErrorHandling(() => runAgentMode(goal), "Agent Mode");
  });

program
  .command("plan [goal...]")
  .description("Run Plan Mode to research, plan, and execute steps")
  .action(async (goalParts: string[]) => {
    const goal = goalParts?.join(" ").trim() || undefined;
    await withErrorHandling(() => runPlanMode(goal), "Plan Mode");
  });

program
  .command("whatsapp")
  .description("Launch the WhatsApp Bot (QR code or phone pairing)")
  .option("--reset-auth", "Clear saved WhatsApp credentials and re-link", false)
  .action(async (opts: { resetAuth?: boolean }) => {
    await withErrorHandling(
      () => runWhatsAppMode({ resetAuth: Boolean(opts.resetAuth) }),
      "WhatsApp Mode",
    );
  });

program
  .command("telegram")
  .description("Launch the Telegram Bot")
  .action(async () => {
    await withErrorHandling(() => runTelegramMode(), "Telegram Mode");
  });

program
  .command("doctor")
  .description("Check environment variables, sessions, and workspace health")
  .action(() => {
    runDoctor();
  });

program
  .command("undo")
  .description("Revert the last applied file-change batch")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .action(async (opts: { yes?: boolean }) => {
    await withErrorHandling(() => runUndoCli(Boolean(opts.yes)), "Undo");
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleError(error);
  process.exitCode = 1;
}
