import type { proto } from "@whiskeysockets/baileys";

/**
 * Extract plain text from a Baileys WAMessage payload, unwrapping
 * ephemeral/viewOnce containers if present.
 */
export function extractIncomingText(
  message?: proto.IMessage | null,
): string {
  if (!message) return "";

  const unwrapped =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.documentWithCaptionMessage?.message ??
    message;

  return (
    unwrapped.conversation ??
    unwrapped.extendedTextMessage?.text ??
    unwrapped.imageMessage?.caption ??
    unwrapped.videoMessage?.caption ??
    unwrapped.documentMessage?.caption ??
    ""
  ).trim();
}

export interface ParsedWhatsAppCommand {
  command: string;
  arg: string;
  hasPrefix: boolean;
}

/**
 * Parses commands starting with `/` or `!` (e.g. `/ask ...` or `!agent ...`),
 * as well as bare session replies (e.g. `approve`, `toggle 1,2`, `proceed`).
 */
export function parseWhatsAppCommand(rawText: string): ParsedWhatsAppCommand {
  const trimmed = rawText.trim();
  const hasPrefix = trimmed.startsWith("/") || trimmed.startsWith("!");
  const body = hasPrefix ? trimmed.slice(1).trim() : trimmed;

  const firstSpace = body.search(/\s/);
  if (firstSpace === -1) {
    return {
      command: body.toLowerCase(),
      arg: "",
      hasPrefix,
    };
  }

  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    arg: body.slice(firstSpace).trim(),
    hasPrefix,
  };
}

/**
 * Convert standard Markdown output from LLMs to clean WhatsApp formatting:
 * - `**bold**` -> `*bold*`
 * - `# Heading` -> `*Heading*`
 * Leaves fenced code blocks untouched.
 */
export function markdownToWhatsApp(md: string): string {
  const parts = md.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      return part
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
        .replace(/__([^_\n]+)__/g, "_$1_");
    })
    .join("");
}
