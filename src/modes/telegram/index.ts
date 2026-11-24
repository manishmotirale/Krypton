import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";

export async function runTelegramMode() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const ownerId = process.env.TELEGRAM_OWNER_ID?.trim();

  if (!token || !ownerId) {
    console.error(chalk.red("\n❌ Telegram Configuration Missing:\n"));
    if (!token) console.error(chalk.red("  • TELEGRAM_BOT_TOKEN is required"));
    if (!ownerId) console.error(chalk.red("  • TELEGRAM_OWNER_ID is required"));
    console.error(
      chalk.yellow(
        "\n💡 Add these to your .env file to use Telegram mode (see .env.example).\n",
      ),
    );
    return;
  }

  const bot = new Telegraf(token);
  registerHandlers(bot);

  try {
    await bot.telegram.sendMessage(ownerId, WELCOME, {
      parse_mode: "Markdown",
    });
    console.log(chalk.green("✓ Sent welcome message to Telegram owner."));
  } catch (err) {
    console.warn(
      chalk.yellow(
        `⚠️ Could not send startup welcome message (send /start to your bot first): ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  bot.launch().catch((err) => {
    console.error(chalk.red("Telegram bot launch error:"), err);
  });

  console.log(
    chalk.green("✓ Telegram Bot is online! Send /help on Telegram. Press Ctrl+C to stop.\n"),
  );

  await new Promise<void>((resolve) => {
    const stop = () => {
      console.log(chalk.dim("\nStopping Telegram Bot..."));
      try {
        bot.stop("SIGINT");
      } catch {
        // ignore if already stopped
      }
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
