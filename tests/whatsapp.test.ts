import { afterEach, describe, expect, it } from "bun:test";
import {
  SentMessageTracker,
  extractDigitsFromJid,
  isAuthorizedWhatsAppMessage,
} from "../src/modes/whatsapp/auth";
import {
  handleWhatsAppMessage,
  type WhatsAppClientAdapter,
} from "../src/modes/whatsapp/handlers";
import {
  parseStepNumbers,
  waApprovalSessions,
  waPlanSessions,
} from "../src/modes/whatsapp/session";
import {
  markdownToWhatsApp,
  parseWhatsAppCommand,
} from "../src/modes/whatsapp/text";
import { ActionTracker } from "../src/modes/agent/action-tracker";
import { ToolExecutor } from "../src/modes/agent/tool-executor";
import { defaultAgentConfig } from "../src/modes/agent/types";
import { getActiveModelId, setActiveModelId } from "../src/config/env";

describe("WhatsApp Auth & Formatting", () => {
  it("extracts digits from WhatsApp JIDs with device suffixes", () => {
    expect(extractDigitsFromJid("919876543210:12@s.whatsapp.net")).toBe("919876543210");
    expect(extractDigitsFromJid("15551234567@s.whatsapp.net")).toBe("15551234567");
    expect(extractDigitsFromJid(undefined)).toBe("");
  });

  it("authorizes self-chat and allowlist numbers while blocking groups and outbound chats to others", () => {
    const base = {
      myJid: "919876543210:4@s.whatsapp.net",
      myLid: "1234567890@lid",
      allowedNumbers: ["15551234567"],
      allowSelfChat: true,
    };

    // Self-chat ("Message Yourself") -> allowed
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "919876543210@s.whatsapp.net",
        fromMe: true,
      }),
    ).toBe(true);

    // Outbound message to another person -> MUST be blocked
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "15551234567@s.whatsapp.net",
        fromMe: true,
      }),
    ).toBe(false);

    // Inbound message from allowed number -> allowed
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "15551234567@s.whatsapp.net",
        fromMe: false,
      }),
    ).toBe(true);

    // Inbound message from unknown number -> blocked
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "19998887777@s.whatsapp.net",
        fromMe: false,
      }),
    ).toBe(false);

    // Unbound group chat -> blocked
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "12036300000000@g.us",
        participant: "15551234567@s.whatsapp.net",
        fromMe: false,
      }),
    ).toBe(false);

    // Dedicated bound KRYPTON group chat -> allowed for owner and allowlisted numbers, blocked for strangers
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "12036399999999@g.us",
        fromMe: true,
        boundGroupJid: "12036399999999@g.us",
      }),
    ).toBe(true);
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "12036399999999@g.us",
        participant: "19998887777@s.whatsapp.net",
        fromMe: false,
        boundGroupJid: "12036399999999@g.us",
      }),
    ).toBe(false);

    // Broadcast status -> blocked
    expect(
      isAuthorizedWhatsAppMessage({
        ...base,
        remoteJid: "status@broadcast",
        fromMe: false,
      }),
    ).toBe(false);
  });

  it("tracks outbound message IDs with bounded capacity", () => {
    const tracker = new SentMessageTracker(2);
    tracker.track("m1");
    tracker.track("m2");
    expect(tracker.has("m1")).toBe(true);
    tracker.track("m3");
    expect(tracker.has("m1")).toBe(false);
    expect(tracker.has("m3")).toBe(true);
  });

  it("parses commands with /, !, and bare words", () => {
    expect(parseWhatsAppCommand("/ask Where is auth?")).toEqual({
      command: "ask",
      arg: "Where is auth?",
      hasPrefix: true,
    });
    expect(parseWhatsAppCommand("!agent add tests")).toEqual({
      command: "agent",
      arg: "add tests",
      hasPrefix: true,
    });
    expect(parseWhatsAppCommand("approve")).toEqual({
      command: "approve",
      arg: "",
      hasPrefix: false,
    });
  });

  it("converts Markdown to WhatsApp syntax without touching code blocks", () => {
    const input = "## Title\nUse **bold** here.\n```ts\nconst x = **notBold**;\n```";
    const out = markdownToWhatsApp(input);
    expect(out).toContain("*Title*");
    expect(out).toContain("Use *bold* here.");
    expect(out).toContain("const x = **notBold**;");
  });

  it("parses step ranges and comma-separated lists", () => {
    expect(parseStepNumbers("1, 3-5, 99", 5)).toEqual([1, 3, 4, 5]);
    expect(parseStepNumbers("4-2", 5)).toEqual([2, 3, 4]);
  });
});

describe("WhatsApp Command Handler Flows", () => {
  const jid = "919876543210@s.whatsapp.net";

  afterEach(() => {
    waPlanSessions.clear();
    waApprovalSessions.clear();
    setActiveModelId(null);
  });

  function createMockClient() {
    const sent: string[] = [];
    const client: WhatsAppClientAdapter = {
      sendText: async (_j, text) => {
        sent.push(text);
      },
      setTyping: async () => {},
    };
    return { client, sent };
  }

  it("ignores casual unprefixed messages when no session is active", async () => {
    const { client, sent } = createMockClient();
    await handleWhatsAppMessage(client, jid, "Hey just taking a note for later");
    expect(sent.length).toBe(0);
  });

  it("handles /help, /status, and /model switching", async () => {
    const { client, sent } = createMockClient();

    await handleWhatsAppMessage(client, jid, "/help");
    expect(sent[0]).toContain("Welcome to KRYPTON!");

    await handleWhatsAppMessage(client, jid, "/model anthropic/claude-sonnet-4");
    expect(getActiveModelId()).toBe("anthropic/claude-sonnet-4");

    await handleWhatsAppMessage(client, jid, "/status");
    expect(sent[sent.length - 1]).toContain("anthropic/claude-sonnet-4");

    await handleWhatsAppMessage(client, jid, "/model reset");
    expect(sent[sent.length - 1]).toContain("Model reset");
  });

  it("handles interactive plan toggle, none, all, and cancel", async () => {
    const { client, sent } = createMockClient();

    waPlanSessions.set(jid, {
      plan: {
        goal: "Test plan",
        steps: [
          { id: "step-1", title: "Step One", description: "Desc 1" },
          { id: "step-2", title: "Step Two", description: "Desc 2" },
        ],
      },
      selected: new Set(["step-1", "step-2"]),
    });

    await handleWhatsAppMessage(client, jid, "toggle 1");
    expect(waPlanSessions.get(jid)?.selected.has("step-1")).toBe(false);
    expect(waPlanSessions.get(jid)?.selected.has("step-2")).toBe(true);

    await handleWhatsAppMessage(client, jid, "none");
    expect(waPlanSessions.get(jid)?.selected.size).toBe(0);

    await handleWhatsAppMessage(client, jid, "all");
    expect(waPlanSessions.get(jid)?.selected.size).toBe(2);

    await handleWhatsAppMessage(client, jid, "cancel");
    expect(waPlanSessions.has(jid)).toBe(false);
    expect(sent[sent.length - 1]).toContain("cancelled");
  });

  it("handles interactive approval diff and reject", async () => {
    const { client, sent } = createMockClient();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, defaultAgentConfig());
    const action = tracker.log({
      type: "file_create",
      path: "demo.txt",
      details: { after: "hello world" },
      status: "pending",
    });

    waApprovalSessions.set(jid, {
      tracker,
      executor,
      pending: [action],
    });

    await handleWhatsAppMessage(client, jid, "diff");
    expect(sent[0]).toContain("+hello world");

    await handleWhatsAppMessage(client, jid, "reject");
    expect(waApprovalSessions.has(jid)).toBe(false);
    expect(action.status).toBe("rejected");
    expect(sent[sent.length - 1]).toContain("rejected");
  });
});
