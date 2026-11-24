import { select, isCancel } from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import { runCliMode } from "../modes/cli";
import { runTelegramMode } from "../modes/telegram";
import { runWhatsAppMode } from "../modes/whatsapp";
import { runDoctor, runUndoCli } from "../modes/doctor";
import { APP_TAGLINE, APP_VERSION } from "../lib/version";
import { withErrorHandling } from "../lib/error-handler";

const BANNER_FONT = "ANSI Shadow";

const FALLBACK_BANNER = [
  "██╗  ██╗██████╗ ██╗   ██╗██████╗ ████████╗ ██████╗ ███╗   ██╗",
  "██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔══██╗╚══██╔══╝██╔═══██╗████╗  ██║",
  "█████╔╝ ██████╔╝ ╚████╔╝ ██████╔╝   ██║   ██║   ██║██╔██╗ ██║",
  "██╔═██╗ ██╔══██╗  ╚██╔╝  ██╔═══╝    ██║   ██║   ██║██║╚██╗██║",
  "██║  ██╗██║  ██║   ██║   ██║        ██║   ╚██████╔╝██║ ╚████║",
  "╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝        ╚═╝    ╚═════╝ ╚═╝  ╚═══╝",
].join("\n");

// Main colors
const FACE = chalk.hex("#EDE7FF").bold;
const PURPLE = chalk.hex("#8B5CF6");
const BLUE = chalk.hex("#38BDF8");
const CYAN = chalk.hex("#22D3EE");

// Subtle shadow colors
const SHADOW_DARK = chalk.hex("#31205F");
const SHADOW_LIGHT = chalk.hex("#5B4D9E");

function printBannerWithShadow(ascii: string) {
  const bannerLines = ascii.replace(/\s+$/, "").split("\n");
  const lines = bannerLines.filter((line) => line.trim().length > 0);

  if (process.stdout.isTTY) {
    for (const line of lines) {
      console.log(SHADOW_DARK(` ${line}`));
    }
    process.stdout.write(`\x1b[${lines.length}A`);

    for (const line of lines) {
      console.log(SHADOW_LIGHT(` ${line}`));
    }
    process.stdout.write(`\x1b[${lines.length}A`);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let coloredLine: string;

    if (i < lines.length / 3) {
      coloredLine = CYAN(line);
    } else if (i < (lines.length * 2) / 3) {
      coloredLine = BLUE(line);
    } else {
      coloredLine = PURPLE(line);
    }

    console.log(FACE(coloredLine));
  }

  console.log(chalk.dim(`  v${APP_VERSION} — ${APP_TAGLINE}\n`));
}

export async function runWakeup(_params?: unknown) {
  let ascii: string;

  try {
    ascii = figlet.textSync("KRYPTON", {
      font: BANNER_FONT,
      horizontalLayout: "default",
      verticalLayout: "default",
    });
  } catch {
    try {
      ascii = figlet.textSync("KRYPTON", {
        font: "Standard",
      });
    } catch {
      ascii = FALLBACK_BANNER;
    }
  }

  printBannerWithShadow(ascii);

  while (true) {
    const mode = await select({
      message: "Which mode do you want to use?",
      options: [
        {
          value: "cli",
          label: "🤖 AI Mode (CLI)",
          hint: "Agent, Plan, and Ask modes",
        },
        {
          value: "whatsapp",
          label: "💚 WhatsApp Mode (Bot)",
          hint: "Chat & automate remotely from WhatsApp",
        },
        {
          value: "telegram",
          label: "💬 Telegram Mode (Bot)",
          hint: "Chat & automate remotely from Telegram",
        },
        {
          value: "doctor",
          label: "🩺 System Diagnostics",
          hint: "Check API keys, sessions & workspace",
        },
        {
          value: "undo",
          label: "↩️  Undo Last Changes",
          hint: "Revert last applied agent batch",
        },
        { value: "exit", label: "🚪 Exit" },
      ],
    });

    if (isCancel(mode) || mode === "exit") {
      console.log(chalk.dim("Goodbye!"));
      return;
    }

    if (mode === "cli") {
      await runCliMode();
    } else if (mode === "whatsapp") {
      await withErrorHandling(() => runWhatsAppMode(), "WhatsApp Mode");
    } else if (mode === "telegram") {
      await withErrorHandling(() => runTelegramMode(), "Telegram Mode");
    } else if (mode === "doctor") {
      runDoctor();
    } else if (mode === "undo") {
      await withErrorHandling(() => runUndoCli(), "Undo");
    }
  }
}
