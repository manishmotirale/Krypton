import { describe, expect, it } from "bun:test";
import { splitMessage } from "../src/modes/shared/bot-runner";
import { isOwner } from "../src/modes/telegram/auth";
import { commandArg } from "../src/modes/telegram/text";

describe("Shared Bot Runner & Telegram Helpers", () => {
  it("splits long messages cleanly on line boundaries", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: some content here`);
    const full = lines.join("\n");
    const chunks = splitMessage(full, 200);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
    }
    expect(chunks.join("\n").replace(/\s+/g, " ")).toBe(full.replace(/\s+/g, " "));
  });

  it("parses Telegram commands with or without @botname suffix", () => {
    expect(commandArg("/ask Where is config?", "ask")).toBe("Where is config?");
    expect(commandArg("/ask@KryptonBot Where is config?", "ask")).toBe(
      "Where is config?",
    );
    expect(commandArg("/plan", "plan")).toBe("");
  });

  it("validates Telegram owner safely including undefined chat IDs", () => {
    const prev = process.env.TELEGRAM_OWNER_ID;
    try {
      process.env.TELEGRAM_OWNER_ID = "123456789";
      expect(isOwner(123456789)).toBe(true);
      expect(isOwner(999999999)).toBe(false);
      expect(isOwner(undefined)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_OWNER_ID;
      else process.env.TELEGRAM_OWNER_ID = prev;
    }
  });
});
