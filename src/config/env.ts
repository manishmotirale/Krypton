import fs from "node:fs";
import path from "node:path";
import { LogLevel, logger } from "../lib/logger";

let runtimeModelOverride: string | null = null;

function parseAndApplyEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function envCandidatePaths(): string[] {
  const execDir = path.dirname(process.execPath);
  return [
    ...new Set([
      path.resolve(process.cwd(), ".env"),
      path.resolve(execDir, ".env"),
      path.resolve(execDir, "..", ".env"),
      path.resolve(execDir, "..", "..", ".env"),
    ]),
  ];
}

/**
 * Loads `.env` from the current working directory first, then falls back to
 * the executable's own directory and its parent directories (so double-clicking
 * `dist/krypton.exe` automatically finds the project's `.env`).
 */
export function loadEnvFiles(): string | null {
  let found: string | null = null;
  for (const candidate of envCandidatePaths()) {
    if (parseAndApplyEnvFile(candidate) && !found) {
      found = candidate;
    }
  }
  return found;
}

export function findEnvFilePath(): string | null {
  for (const candidate of envCandidatePaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function getAppBaseDir(): string {
  const envFile = findEnvFilePath();
  return envFile ? path.dirname(envFile) : process.cwd();
}

export function initLogLevel(): void {
  const raw = process.env.LOG_LEVEL?.trim().toUpperCase();
  switch (raw) {
    case "DEBUG":
      logger.setLevel(LogLevel.DEBUG);
      break;
    case "WARN":
      logger.setLevel(LogLevel.WARN);
      break;
    case "ERROR":
      logger.setLevel(LogLevel.ERROR);
      break;
    default:
      logger.setLevel(LogLevel.INFO);
      break;
  }
}

export function getActiveModelId(): string {
  return (
    runtimeModelOverride ||
    process.env.OPENROUTER_DEFAULT_MODEL?.trim() ||
    "openrouter/auto"
  );
}

export function setActiveModelId(modelId: string | null): void {
  const trimmed = modelId?.trim() || null;
  runtimeModelOverride = trimmed;
}

export function hasFirecrawlConfig(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export function hasTelegramConfig(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_OWNER_ID?.trim(),
  );
}

export function getWhatsAppConfig() {
  const rawAllowed = process.env.WHATSAPP_ALLOWED_NUMBERS ?? "";
  const allowedNumbers = rawAllowed
    .split(/[,;\s]+/)
    .map((n) => n.replace(/[^\d]/g, ""))
    .filter((n) => n.length >= 7);

  const allowSelfRaw = process.env.WHATSAPP_ALLOW_SELF_CHAT?.trim().toLowerCase();
  const allowSelfChat =
    allowSelfRaw === undefined || allowSelfRaw === ""
      ? true
      : allowSelfRaw === "true" || allowSelfRaw === "1" || allowSelfRaw === "yes";

  const pairingPhone =
    process.env.WHATSAPP_PAIRING_PHONE?.replace(/[^\d]/g, "") || undefined;

  const authDir = path.resolve(
    getAppBaseDir(),
    process.env.WHATSAPP_AUTH_DIR?.trim() || ".krypton/whatsapp-auth",
  );

  return {
    allowedNumbers,
    allowSelfChat,
    pairingPhone,
    authDir,
  };
}

export interface DiagnosticCheck {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
}

export function runEnvDiagnostics(): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  checks.push({
    name: "OpenRouter API Key",
    status: apiKey ? "ok" : "error",
    detail: apiKey
      ? `Configured (${apiKey.slice(0, 8)}...${apiKey.slice(-4)})`
      : "Missing OPENROUTER_API_KEY in .env (required for AI modes)",
  });

  const modelId = getActiveModelId();
  checks.push({
    name: "Default AI Model",
    status: process.env.OPENROUTER_DEFAULT_MODEL?.trim() ? "ok" : "warn",
    detail: process.env.OPENROUTER_DEFAULT_MODEL?.trim()
      ? modelId
      : `Not explicitly set; falling back to "${modelId}"`,
  });

  checks.push({
    name: "Firecrawl Web Tools",
    status: hasFirecrawlConfig() ? "ok" : "warn",
    detail: hasFirecrawlConfig()
      ? "Configured (web_search & web_crawl enabled)"
      : "Optional — set FIRECRAWL_API_KEY to enable web search/scraping",
  });

  const hasTgToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hasTgOwner = Boolean(process.env.TELEGRAM_OWNER_ID?.trim());
  checks.push({
    name: "Telegram Bot",
    status: hasTgToken && hasTgOwner ? "ok" : "warn",
    detail:
      hasTgToken && hasTgOwner
        ? `Configured (Owner ID: ${process.env.TELEGRAM_OWNER_ID?.trim()})`
        : "Optional — set TELEGRAM_BOT_TOKEN & TELEGRAM_OWNER_ID to enable",
  });

  const wa = getWhatsAppConfig();
  checks.push({
    name: "WhatsApp Bot",
    status: "ok",
    detail: `Ready (self-chat: ${wa.allowSelfChat ? "on" : "off"}, allowlist: ${
      wa.allowedNumbers.length > 0 ? wa.allowedNumbers.join(", ") : "none"
    })`,
  });

  return checks;
}
