import fs from "node:fs";
import chalk from "chalk";
import pino from "pino";
import qrcode from "qrcode-terminal";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { getActiveModelId, getWhatsAppConfig } from "../../config/env";
import {
  SentMessageTracker,
  extractDigitsFromJid,
  isAuthorizedWhatsAppMessage,
  loadChatBinding,
  saveChatBinding,
} from "./auth";
import { WA_WELCOME } from "./constants";
import { handleWhatsAppMessage, type WhatsAppClientAdapter } from "./handlers";
import { extractIncomingText, parseWhatsAppCommand } from "./text";

export interface WhatsAppModeOptions {
  resetAuth?: boolean;
}

export async function runWhatsAppMode(
  options: WhatsAppModeOptions = {},
): Promise<void> {
  const waConfig = getWhatsAppConfig();

  if (!waConfig.allowSelfChat && waConfig.allowedNumbers.length === 0) {
    console.error(chalk.red("\n❌ WhatsApp Authorization Misconfigured:\n"));
    console.error(
      chalk.red(
        "  WHATSAPP_ALLOW_SELF_CHAT is disabled and WHATSAPP_ALLOWED_NUMBERS is empty.",
      ),
    );
    console.error(
      chalk.yellow(
        "💡 Enable WHATSAPP_ALLOW_SELF_CHAT=true or set WHATSAPP_ALLOWED_NUMBERS in .env.\n",
      ),
    );
    return;
  }

  if (options.resetAuth && fs.existsSync(waConfig.authDir)) {
    fs.rmSync(waConfig.authDir, { recursive: true, force: true });
    console.log(chalk.yellow("✓ Cleared previous WhatsApp session credentials.\n"));
  }

  fs.mkdirSync(waConfig.authDir, { recursive: true });

  console.log(chalk.bold.green("\n💚 Starting KRYPTON WhatsApp Bot...\n"));
  console.log(chalk.dim(`  Auth directory : ${waConfig.authDir}`));
  console.log(chalk.dim(`  Active model   : ${getActiveModelId()}`));
  console.log(
    chalk.dim(
      `  Self-chat      : ${waConfig.allowSelfChat ? "enabled (Message Yourself)" : "disabled"}`,
    ),
  );
  console.log(
    chalk.dim(
      `  Allowlist      : ${waConfig.allowedNumbers.length ? waConfig.allowedNumbers.join(", ") : "(self-chat only)"}`,
    ),
  );
  let chatBinding = loadChatBinding(waConfig.authDir);

  if (chatBinding.boundGroupJid) {
    console.log(
      chalk.dim(
        `  Dedicated chat : ${chatBinding.boundGroupName || chatBinding.boundGroupJid}`,
      ),
    );
  }
  console.log();

  const sentTracker = new SentMessageTracker();
  const silentLogger = pino({ level: "silent" });
  let currentSocket: WASocket | null = null;
  let stopped = false;
  let reconnectAttempts = 0;
  let welcomeSentThisRun = false;
  let pairingRequested = false;

  let resolveRun!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveRun = resolve;
  });

  const cleanupAndStop = () => {
    if (stopped) return;
    stopped = true;
    console.log(chalk.dim("\nStopping WhatsApp Bot..."));
    try {
      currentSocket?.end(undefined);
    } catch {
      // ignore close errors
    }
    process.off("SIGINT", cleanupAndStop);
    process.off("SIGTERM", cleanupAndStop);
    resolveRun();
  };

  process.on("SIGINT", cleanupAndStop);
  process.on("SIGTERM", cleanupAndStop);

  async function connect(): Promise<void> {
    if (stopped) return;

    const { state, saveCreds } = await useMultiFileAuthState(waConfig.authDir);

    let version: [number, number, number] | undefined;
    try {
      const waLatest = await fetchLatestWaWebVersion({});
      version = waLatest.version;
    } catch {
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        // Fallback to Baileys bundled WA Web version if offline check fails
      }
    }

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger as never),
      },
      logger: silentLogger as never,
      browser: Browsers.macOS("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60_000,
    });

    currentSocket = sock;
    sock.ev.on("creds.update", saveCreds);

    const adapter: WhatsAppClientAdapter = {
      sendText: async (jid: string, text: string) => {
        const sent = await sock.sendMessage(jid, { text });
        sentTracker.track(sent?.key?.id);
      },
      setTyping: async (jid: string, typing: boolean) => {
        try {
          await sock.sendPresenceUpdate(typing ? "composing" : "paused", jid);
        } catch {
          // Presence updates are best-effort
        }
      },
    };

    // Optional phone-number pairing code flow (no QR scan required)
    if (
      waConfig.pairingPhone &&
      !sock.authState.creds.registered &&
      !pairingRequested
    ) {
      pairingRequested = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(waConfig.pairingPhone!);
          console.log(chalk.bold.cyan("\n🔑 WhatsApp Pairing Code:\n"));
          console.log(chalk.bold.white(`    ${code}\n`));
          console.log(
            chalk.dim(
              "  Open WhatsApp → Linked Devices → Link a Device → Link with phone number instead.\n",
            ),
          );
        } catch (err) {
          console.error(
            chalk.yellow(
              `⚠️ Failed to request pairing code (falling back to QR): ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        }
      }, 2500);
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !waConfig.pairingPhone) {
        console.log(
          chalk.bold.cyan(
            "\n📱 Scan this QR code in WhatsApp (Settings → Linked Devices → Link a Device):\n",
          ),
        );
        qrcode.generate(qr, { small: true });
        console.log();
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        const myJid = sock.user?.id;
        const myDigits = extractDigitsFromJid(myJid);

        console.log(
          chalk.bold.green(
            `✓ Connected to WhatsApp!${myDigits ? ` (Account: +${myDigits})` : ""}`,
          ),
        );

        if (chatBinding.boundGroupJid) {
          console.log(
            chalk.cyan(
              `  📌 Dedicated KRYPTON chat: "${chatBinding.boundGroupName || chatBinding.boundGroupJid}"`,
            ),
          );
        } else if (myDigits) {
          console.log(
            chalk.cyan(
              `  💬 Where to chat right now: Open WhatsApp → your "+${myDigits} (You)" ("Message Yourself") chat`,
            ),
          );
          console.log(
            chalk.dim(
              `  💡 Want a dedicated "KRYPTON" chat? Create a private WhatsApp group named KRYPTON and send "/bind" in it.`,
            ),
          );
        }
        console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

        if (!welcomeSentThisRun) {
          welcomeSentThisRun = true;
          const targetJid =
            chatBinding.boundGroupJid ||
            (waConfig.allowSelfChat && myDigits
              ? `${myDigits}@s.whatsapp.net`
              : null);

          if (targetJid) {
            try {
              await adapter.sendText(targetJid, WA_WELCOME);
              console.log(
                chalk.green(
                  `✓ Welcome message sent to ${
                    chatBinding.boundGroupJid
                      ? `"${chatBinding.boundGroupName || "KRYPTON"}" group`
                      : `"+${myDigits} (You)" chat`
                  }!`,
                ),
              );
            } catch {
              // Non-fatal if welcome cannot be pushed immediately
            }
          }
        }
      }

      if (connection === "close") {
        if (stopped) return;

        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isRestartRequired =
          statusCode === DisconnectReason.restartRequired || statusCode === 515;

        if (isLoggedOut) {
          console.error(
            chalk.red(
              "\n❌ WhatsApp session was logged out. Clearing auth state — restart WhatsApp mode to re-link.\n",
            ),
          );
          fs.rmSync(waConfig.authDir, { recursive: true, force: true });
          cleanupAndStop();
          return;
        }

        if (isRestartRequired) {
          // WhatsApp sends 515 right after QR scan — reconnect immediately to finish linking!
          console.log(
            chalk.cyan("🔄 Pairing handshake received — reconnecting immediately..."),
          );
          reconnectAttempts = 0;
          void connect();
          return;
        }

        reconnectAttempts++;
        const delayMs = Math.min(30_000, 1500 * Math.pow(1.5, reconnectAttempts - 1));
        console.warn(
          chalk.yellow(
            `⚠️ WhatsApp connection closed (code: ${statusCode ?? "unknown"}). Reconnecting in ${(
              delayMs / 1000
            ).toFixed(1)}s...`,
          ),
        );
        setTimeout(() => {
          void connect();
        }, delayMs);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const msgId = msg.key.id;
        if (sentTracker.has(msgId)) continue;

        const remoteJid = msg.key.remoteJid;
        const participant = msg.key.participant;
        const fromMe = msg.key.fromMe;

        const text = extractIncomingText(msg.message);
        if (!text || !remoteJid) continue;

        // Owner can send /bind inside any WhatsApp group to make it the dedicated KRYPTON chat
        const parsed = parseWhatsAppCommand(text);
        if (fromMe && remoteJid.endsWith("@g.us") && parsed.hasPrefix) {
          if (parsed.command === "bind") {
            let groupName = "KRYPTON";
            try {
              const meta = await sock.groupMetadata(remoteJid);
              if (meta?.subject) groupName = meta.subject;
            } catch {
              // Fallback to default name
            }
            chatBinding = { boundGroupJid: remoteJid, boundGroupName: groupName };
            saveChatBinding(waConfig.authDir, chatBinding);
            console.log(
              chalk.green(`✓ Bound dedicated KRYPTON chat to group "${groupName}" (${remoteJid})`),
            );
            await adapter.sendText(
              remoteJid,
              `📌 *Dedicated KRYPTON Chat Bound!*\n\nThis group (*${groupName}*) is now your official KRYPTON bot chat.\nSend \`/help\` to see all commands, or \`/unbind\` to disconnect this group.`,
            );
            continue;
          }

          if (
            parsed.command === "unbind" &&
            chatBinding.boundGroupJid === remoteJid
          ) {
            chatBinding = { boundGroupJid: null };
            saveChatBinding(waConfig.authDir, chatBinding);
            console.log(chalk.yellow(`✓ Unbound dedicated KRYPTON group (${remoteJid})`));
            await adapter.sendText(
              remoteJid,
              "🔓 Unbound this group. KRYPTON will no longer reply here.",
            );
            continue;
          }
        }

        const allowed = isAuthorizedWhatsAppMessage({
          remoteJid,
          participant,
          fromMe,
          myJid: sock.user?.id,
          myLid: (sock.user as { lid?: string } | undefined)?.lid,
          allowedNumbers: waConfig.allowedNumbers,
          allowSelfChat: waConfig.allowSelfChat,
          boundGroupJid: chatBinding.boundGroupJid,
        });

        if (!allowed) continue;

        console.log(
          chalk.dim(
            `[WhatsApp] ${extractDigitsFromJid(participant || remoteJid) || remoteJid}: ${text.slice(0, 80)}`,
          ),
        );

        const isDedicatedChat = Boolean(
          chatBinding.boundGroupJid && remoteJid === chatBinding.boundGroupJid,
        );

        void handleWhatsAppMessage(adapter, remoteJid, text, {
          isDedicatedChat,
        }).catch((err) => {
          console.error(chalk.red("[WhatsApp handler error]"), err);
        });
      }
    });
  }

  await connect();
  await donePromise;
}
