import fs from "node:fs";
import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import {
  findEnvFilePath,
  getActiveModelId,
  getWhatsAppConfig,
  runEnvDiagnostics,
  setActiveModelId,
} from "../config/env";
import { APP_NAME, APP_VERSION } from "../lib/version";
import { UndoManager } from "./agent/undo-manager";

export function runDoctor(): void {
  console.log(chalk.bold.cyan(`\n🩺 ${APP_NAME} v${APP_VERSION} — System Diagnostics\n`));

  console.log(chalk.dim(`  Workspace : ${process.cwd()}`));
  console.log(chalk.dim(`  Runtime   : Bun ${typeof Bun !== "undefined" ? Bun.version : process.version}`));
  console.log(chalk.dim(`  Platform  : ${process.platform} (${process.arch})`));
  console.log();

  const envFilePath = findEnvFilePath();
  console.log(
    envFilePath
      ? chalk.green("  ✓ .env file          ") + chalk.dim(`Found (${envFilePath})`)
      : chalk.yellow("  ! .env file          ") +
          chalk.dim("Not found (run `cp .env.example .env`)"),
  );

  for (const check of runEnvDiagnostics()) {
    const icon =
      check.status === "ok"
        ? chalk.green("  ✓")
        : check.status === "warn"
          ? chalk.yellow("  !")
          : chalk.red("  ✗");
    const label = check.name.padEnd(20);
    console.log(`${icon} ${label} ${chalk.dim(check.detail)}`);
  }

  const wa = getWhatsAppConfig();
  const waLinked =
    fs.existsSync(wa.authDir) &&
    fs.readdirSync(wa.authDir).some((f) => f.includes("creds"));
  console.log(
    (waLinked ? chalk.green("  ✓") : chalk.yellow("  !")) +
      ` ${"WhatsApp Session".padEnd(20)} ` +
      chalk.dim(
        waLinked
          ? `Linked (${wa.authDir})`
          : "Not linked yet (run `krypton whatsapp` to scan QR)",
      ),
  );

  const undoBatches = new UndoManager(process.cwd()).listHistory();
  console.log(
    chalk.cyan("  ℹ") +
      ` ${"Undo Snapshots".padEnd(20)} ` +
      chalk.dim(`${undoBatches.length} batch(es) available`),
  );

  console.log();
}

export async function runUndoCli(skipConfirm = false): Promise<void> {
  const manager = new UndoManager(process.cwd());
  const history = manager.listHistory();

  if (history.length === 0) {
    console.log(chalk.yellow("\nℹ️ No applied change batches found to undo.\n"));
    return;
  }

  const latest = history[0]!;
  console.log(chalk.bold.cyan("\n↩️ Latest Applied Batch:"));
  console.log(chalk.dim(`  Batch ID : ${latest.id}`));
  console.log(chalk.dim(`  Saved at : ${latest.createdAt}`));
  console.log(chalk.dim(`  Files    : ${latest.files.map((f) => f.relPath).join(", ") || "(none)"}`));
  console.log();

  if (!skipConfirm) {
    const ok = await confirm({
      message: "Revert this batch of changes?",
      initialValue: true,
    });
    if (isCancel(ok) || !ok) {
      console.log(chalk.dim("\nUndo cancelled.\n"));
      return;
    }
  }

  const result = manager.undoLastBatch();
  if (result.success) {
    console.log(chalk.green(`\n✓ ${result.message}`));
    if (result.restored.length) {
      console.log(chalk.dim(`  Restored: ${result.restored.join(", ")}`));
    }
    if (result.removed.length) {
      console.log(chalk.dim(`  Removed : ${result.removed.join(", ")}`));
    }
    console.log();
  } else {
    console.log(chalk.red(`\n❌ ${result.message}`));
    for (const err of result.errors) {
      console.log(chalk.red(`  • ${err}`));
    }
    console.log();
  }
}

export async function runModelSwitchCli(): Promise<void> {
  console.log(
    chalk.bold.cyan(`\n🧠 Current AI Model: `) +
      chalk.white(getActiveModelId()) +
      "\n",
  );

  const nextModel = await text({
    message: 'Enter OpenRouter model ID (or "reset" for default):',
    placeholder: "e.g. anthropic/claude-sonnet-4, google/gemini-2.5-pro, openrouter/auto",
  });

  if (isCancel(nextModel) || !nextModel.trim()) return;

  const trimmed = nextModel.trim();
  if (trimmed.toLowerCase() === "reset") {
    setActiveModelId(null);
    console.log(
      chalk.green(`\n✓ Model reset to default: ${getActiveModelId()}\n`),
    );
  } else {
    setActiveModelId(trimmed);
    console.log(chalk.green(`\n✓ Active model switched to: ${trimmed}\n`));
  }
}
