import { splitMessage } from "../shared/bot-runner";

export async function replyMd(
  ctx: { reply: (text: string, o?: object) => Promise<unknown> },
  text: string,
): Promise<void> {
  const chunks = splitMessage(text, 3900);

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    } catch {
      // Fallback to plain text if Telegram rejects unmatched Markdown entities
      await ctx.reply(chunk);
    }
  }
}

/** Text after /name ... (also handles /name@BotUsername) */
export function commandArg(fullText: string, name: string): string {
  return fullText
    .replace(new RegExp(`^/${name}(?:@\\w+)?\\s*`, "i"), "")
    .trim();
}
