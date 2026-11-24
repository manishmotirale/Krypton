import fs from "node:fs";
import path from "node:path";

/**
 * Extract pure phone digits from a WhatsApp JID such as
 * "919876543210:12@s.whatsapp.net" -> "919876543210".
 */
export function extractDigitsFromJid(jid?: string | null): string {
  if (!jid) return "";
  const userPart = jid.split("@")[0] ?? "";
  const baseUser = userPart.split(":")[0] ?? "";
  return baseUser.replace(/[^\d]/g, "");
}

function normalizeBaseJid(jid?: string | null): string {
  if (!jid) return "";
  const [userPart, domain] = jid.split("@");
  if (!userPart || !domain) return jid.toLowerCase();
  const baseUser = userPart.split(":")[0] ?? userPart;
  return `${baseUser}@${domain}`.toLowerCase();
}

export interface WhatsAppChatBinding {
  boundGroupJid: string | null;
  boundGroupName?: string;
}

function bindingFilePath(authDir: string): string {
  return path.resolve(path.dirname(authDir), "whatsapp-chat.json");
}

export function loadChatBinding(authDir: string): WhatsAppChatBinding {
  const file = bindingFilePath(authDir);
  if (!fs.existsSync(file)) {
    return { boundGroupJid: process.env.WHATSAPP_GROUP_JID?.trim() || null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WhatsAppChatBinding>;
    return {
      boundGroupJid:
        parsed.boundGroupJid || process.env.WHATSAPP_GROUP_JID?.trim() || null,
      boundGroupName: parsed.boundGroupName,
    };
  } catch {
    return { boundGroupJid: process.env.WHATSAPP_GROUP_JID?.trim() || null };
  }
}

export function saveChatBinding(
  authDir: string,
  binding: WhatsAppChatBinding,
): void {
  const file = bindingFilePath(authDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(binding, null, 2), "utf8");
}

export interface WhatsAppAuthParams {
  remoteJid?: string | null;
  participant?: string | null;
  fromMe?: boolean | null;
  myJid?: string | null;
  myLid?: string | null;
  allowedNumbers: string[];
  allowSelfChat: boolean;
  boundGroupJid?: string | null;
}

/**
 * Authorizes incoming WhatsApp messages:
 * - Always ignores status broadcasts and newsletters
 * - For group chats (`@g.us`): ONLY allows the owner (or allowlisted numbers)
 *   inside the explicitly bound dedicated KRYPTON group chat (`boundGroupJid`)
 * - If `fromMe` is true in a 1:1 chat: only allows the owner's own Self-Chat
 *   ("Message Yourself") when `allowSelfChat` is enabled
 * - If `fromMe` is false in a 1:1 chat: only allows senders in `allowedNumbers`
 */
export function isAuthorizedWhatsAppMessage(params: WhatsAppAuthParams): boolean {
  const {
    remoteJid,
    participant,
    fromMe,
    myJid,
    myLid,
    allowedNumbers,
    allowSelfChat,
    boundGroupJid,
  } = params;

  if (!remoteJid) return false;

  if (
    remoteJid === "status@broadcast" ||
    remoteJid.endsWith("@broadcast") ||
    remoteJid.endsWith("@newsletter")
  ) {
    return false;
  }

  // Group chat: only allowed if it matches the dedicated bound KRYPTON group
  if (remoteJid.endsWith("@g.us")) {
    if (!boundGroupJid) return false;
    if (normalizeBaseJid(remoteJid) !== normalizeBaseJid(boundGroupJid)) {
      return false;
    }
    if (fromMe) return true;
    const senderDigits = extractDigitsFromJid(participant);
    return Boolean(
      senderDigits &&
        allowedNumbers.some((n) => n.replace(/[^\d]/g, "") === senderDigits),
    );
  }

  const remoteNorm = normalizeBaseJid(remoteJid);
  const myJidNorm = normalizeBaseJid(myJid);
  const myLidNorm = normalizeBaseJid(myLid);

  const remoteDigits = extractDigitsFromJid(remoteJid);
  const myDigits = extractDigitsFromJid(myJid);

  const isSelfChat =
    (Boolean(myJidNorm) && remoteNorm === myJidNorm) ||
    (Boolean(myLidNorm) && remoteNorm === myLidNorm) ||
    (Boolean(myDigits) && Boolean(remoteDigits) && remoteDigits === myDigits);

  if (fromMe) {
    return allowSelfChat && isSelfChat;
  }

  if (allowedNumbers.length === 0) {
    return false;
  }

  const senderDigits = extractDigitsFromJid(participant || remoteJid);
  if (!senderDigits) return false;

  return allowedNumbers.some((allowed) => {
    const clean = allowed.replace(/[^\d]/g, "");
    return clean.length >= 7 && senderDigits === clean;
  });
}

/**
 * Tracks outbound message IDs sent by KRYPTON so we never trigger an infinite
 * reply loop when WhatsApp echoes back our own messages in Self-Chat.
 */
export class SentMessageTracker {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly maxEntries = 500) {}

  track(id?: string | null): void {
    if (!id) return;
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.order.push(id);

    if (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
    }
  }

  has(id?: string | null): boolean {
    if (!id) return false;
    return this.ids.has(id);
  }
}
