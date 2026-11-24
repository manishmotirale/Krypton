import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionTracker } from "../src/modes/agent/action-tracker";
import { composeBeforeAfter, formatPatch } from "../src/modes/agent/diff-view";
import { ToolExecutor } from "../src/modes/agent/tool-executor";
import { defaultAgentConfig } from "../src/modes/agent/types";
import { UndoManager } from "../src/modes/agent/undo-manager";

describe("ToolExecutor & UndoManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "krypton-test-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "src", "hello.ts"),
      "export function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n",
      "utf8",
    );
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET_KEY=topsecret\n", "utf8");
    fs.writeFileSync(path.join(tmpDir, "debug.log"), "some log\n", "utf8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeExecutor(overrides?: Partial<ReturnType<typeof defaultAgentConfig>>) {
    const config = {
      ...defaultAgentConfig(),
      codebasePath: tmpDir,
      ...overrides,
    };
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
    return { tracker, executor, config };
  }

  it("blocks path traversal and excluded files like .env and *.log", () => {
    const { executor } = makeExecutor();
    expect(() => executor.readFile("../outside.txt")).toThrow(/escapes codebase/i);
    expect(() => executor.readFile(".env")).toThrow(/excluded/i);
    expect(() => executor.readFile("debug.log")).toThrow(/excluded/i);
  });

  it("supports line-range reading and enforces maxFileSizeToRead", () => {
    const { executor } = makeExecutor();
    const range = executor.readFile("src/hello.ts", 2, 2);
    expect(range).toBe("2:   return `Hello, ${name}!`;");

    const { executor: smallExec } = makeExecutor({ maxFileSizeToRead: 10 });
    expect(() => smallExec.readFile("src/hello.ts")).toThrow(/maxFileSizeToRead/i);
  });

  it("stages surgical edit_file changes and protects against ambiguous matches", () => {
    const { executor } = makeExecutor();
    executor.editFile("src/hello.ts", "Hello,", "Welcome,");
    expect(executor.readFile("src/hello.ts")).toContain("Welcome, ${name}!");

    expect(() => executor.editFile("src/hello.ts", "not-present", "x")).toThrow(
      /not found/i,
    );

    // Ambiguous multi-match without replaceAll
    executor.createFile("src/dup.txt", "foo\nfoo\n");
    expect(() => executor.editFile("src/dup.txt", "foo", "bar", false)).toThrow(
      /matched 2 times/i,
    );
    executor.editFile("src/dup.txt", "foo", "bar", true);
    expect(executor.readFile("src/dup.txt")).toBe("bar\nbar\n");
  });

  it("enforces tool permission flags", () => {
    const config = defaultAgentConfig();
    config.codebasePath = tmpDir;
    config.tools = {
      allowFileCreation: false,
      allowFileModification: false,
      allowFolderCreation: false,
      allowShellExecution: false,
    };
    const executor = new ToolExecutor(new ActionTracker(), config);

    expect(() => executor.createFile("a.txt", "hi")).toThrow(/disabled/i);
    expect(() => executor.modifyFile("src/hello.ts", "x")).toThrow(/disabled/i);
    expect(() => executor.editFile("src/hello.ts", "Hello", "Hi")).toThrow(/disabled/i);
    expect(() => executor.deleteFile("src/hello.ts")).toThrow(/disabled/i);
    expect(() => executor.createFolder("newdir")).toThrow(/disabled/i);
    expect(() => executor.queueShell("echo hi")).toThrow(/disabled/i);
  });

  it("captures before-content on deleteFile for accurate diffs", () => {
    const { tracker, executor } = makeExecutor();
    executor.deleteFile("src/hello.ts");

    const pending = tracker.getPendingMutations();
    expect(pending.length).toBe(1);
    const { before, after } = composeBeforeAfter(pending);
    expect(before).toContain("export function greet");
    expect(after).toBe("");

    const patch = formatPatch("src/hello.ts", before, after);
    expect(patch).toContain("-export function greet");
  });

  it("searches files with glob patterns and returns line-numbered content matches", () => {
    const { executor } = makeExecutor();
    const files = executor.searchFiles(".", "**/*.ts");
    expect(files).toBe("src/hello.ts");

    const contentMatches = executor.searchFiles(".", "**/*.ts", "greet");
    expect(contentMatches).toContain("src/hello.ts:1:");
  });

  it("analyzes codebase with file counts, total size, and extensions", () => {
    const { executor } = makeExecutor();
    const summary = executor.analyzeCodebase(".");
    expect(summary).toContain("Files: 1");
    expect(summary).toContain("Directories: 1");
    expect(summary).toContain("Total Size:");
    expect(summary).toContain(".ts: 1");
  });

  it("applies approved changes, captures shell stdout, and cleanly undoes with UndoManager", () => {
    const { tracker, executor } = makeExecutor();

    executor.createFolder("src/utils");
    executor.createFile("src/utils/math.ts", "export const add = (a: number, b: number) => a + b;\n");
    executor.editFile("src/hello.ts", "Hello", "Hi");
    executor.queueShell("echo krypton-shell-ok");

    for (const a of tracker.getPendingMutations()) {
      tracker.updateStatus(a.id, "approved", true);
    }

    const res = executor.applyApprovedFromTracker();
    expect(res.errors).toEqual([]);
    expect(res.undoBatchId).toBeTruthy();
    expect(res.outputs.length).toBe(1);
    expect(res.outputs[0]?.stdout).toContain("krypton-shell-ok");

    expect(fs.existsSync(path.join(tmpDir, "src", "utils", "math.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "src", "hello.ts"), "utf8")).toContain("Hi, ${name}!");

    // Now undo!
    const undo = new UndoManager(tmpDir);
    const undoRes = undo.undoLastBatch();
    expect(undoRes.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src", "utils", "math.ts"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "src", "utils"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, "src", "hello.ts"), "utf8")).toContain("Hello, ${name}!");
  });
});
