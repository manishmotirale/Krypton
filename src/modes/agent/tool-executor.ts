import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

import type {
  AgentConfig,
  ActionLog,
  ApplyResult,
  ShellExecutionOutput,
} from "./types";
import { ActionTracker } from "./action-tracker";
import { UndoManager } from "./undo-manager";

function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(Math.max(0, decimals)))} ${sizes[i]}`;
}

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".svg",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".txt",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".graphql",
  ".prisma",
  ".dockerfile",
]);

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  return TEXT_EXT.has(ext) || ext === "" || base === "dockerfile" || base === "makefile";
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  let regexStr = "";

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    const next = normalized[i + 1];

    if (ch === "*" && next === "*") {
      // Handle **/ or **
      if (normalized[i + 2] === "/") {
        regexStr += "(?:.*/)?";
        i += 2;
      } else {
        regexStr += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      regexStr += "[^/]*";
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += "\\" + ch;
    } else {
      regexStr += ch;
    }
  }

  return new RegExp(`^${regexStr}$`, "i");
}

function patternMatchesSegmentOrPath(relPath: string, pattern: string): boolean {
  const cleanPattern = pattern.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!cleanPattern) return false;

  const segments = relPath.split("/").filter(Boolean);

  if (!cleanPattern.includes("*") && !cleanPattern.includes("?")) {
    // Match exact path, prefix, or any path segment (e.g. nested node_modules)
    return (
      relPath === cleanPattern ||
      relPath.startsWith(cleanPattern + "/") ||
      segments.includes(cleanPattern)
    );
  }

  const re = globToRegExp(cleanPattern);
  return re.test(relPath) || segments.some((seg) => re.test(seg));
}

export class ToolExecutor {
  private overlay = new Map<string, string>();
  private deleted = new Set<string>();
  private readonly undoManager: UndoManager;

  private readonly norm = (rel: string) =>
    path.posix
      .normalize(rel.split(path.sep).join("/"))
      .replace(/^\.\/+/, "");

  constructor(
    private readonly tracker: ActionTracker,
    private readonly config: AgentConfig,
  ) {
    this.undoManager = new UndoManager(config.codebasePath);
  }

  // 1. resolveSafe
  private resolveSafe(rel: string): string {
    const base = path.resolve(this.config.codebasePath);
    const target = path.resolve(base, rel);

    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`Path escapes codebase: ${rel}`);
    }

    return target;
  }

  // 2. excluded — honors config.excludePatterns including globs (.env*, *.log) and nested dirs
  private excluded(relPath: string): boolean {
    const rel = this.norm(relPath);
    if (!rel || rel === ".") return false;

    const patterns = this.config.excludePatterns;
    return patterns.some((pattern) => patternMatchesSegmentOrPath(rel, pattern));
  }

  // 3. assertNotExcluded
  private assertNotExcluded(rel: string, op: string): void {
    if (this.excluded(rel)) {
      throw new Error(`${op}: path is excluded: ${rel}`);
    }
  }

  // 4. getEffectiveText
  private getEffectiveText(rel: string): string | undefined {
    const key = this.norm(rel);

    if (this.deleted.has(key)) {
      return undefined;
    }

    if (this.overlay.has(key)) {
      return this.overlay.get(key);
    }

    const abs = this.resolveSafe(key);

    if (!fs.existsSync(abs)) {
      return undefined;
    }

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return undefined;
    }

    if (stat.size > this.config.maxFileSizeToRead) {
      throw new Error(
        `File exceeds maxFileSizeToRead (${formatBytes(stat.size)} > ${formatBytes(this.config.maxFileSizeToRead)}): ${rel}`,
      );
    }

    return fs.readFileSync(abs, "utf8");
  }

  // 5. readFile (with optional 1-based line range)
  readFile(rel: string, startLine?: number, endLine?: number): string {
    this.assertNotExcluded(rel, "read_file");

    const key = this.norm(rel);
    const text = this.getEffectiveText(key);

    if (text === undefined) {
      throw new Error(`read_file: file not found: ${rel}`);
    }

    let output = text;
    if (startLine !== undefined || endLine !== undefined) {
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, startLine ?? 1);
      const end = Math.min(lines.length, endLine ?? lines.length);
      output = lines
        .slice(start - 1, end)
        .map((line, idx) => `${start + idx}: ${line}`)
        .join("\n");
    }

    this.tracker.log({
      type: "code_analysis",
      path: key,
      details: {
        after: output.slice(0, 4000),
        toolName: "read_file",
      },
      status: "executed",
    });

    return output;
  }

  // 6. createFile
  createFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileCreation) {
      throw new Error("create_file: file creation is disabled in this mode");
    }

    this.assertNotExcluded(rel, "create_file");

    const key = this.norm(rel);
    const abs = this.resolveSafe(key);

    const existsOnDisk = fs.existsSync(abs) && !this.deleted.has(key);
    if (existsOnDisk || this.overlay.has(key)) {
      throw new Error(`create_file: file already exists: ${rel}`);
    }

    this.overlay.set(key, content);
    this.deleted.delete(key);

    this.tracker.log({
      type: "file_create",
      path: key,
      details: {
        after: content,
        toolName: "create_file",
      },
      status: "pending",
    });

    return `Staged file creation: ${key}`;
  }

  // 7. modifyFile
  modifyFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileModification) {
      throw new Error("modify_file: file modification is disabled in this mode");
    }

    this.assertNotExcluded(rel, "modify_file");

    const key = this.norm(rel);
    const before = this.getEffectiveText(key);

    if (before === undefined) {
      throw new Error(`modify_file: file not found: ${rel}`);
    }

    this.overlay.set(key, content);
    this.deleted.delete(key);

    this.tracker.log({
      type: "file_modify",
      path: key,
      details: {
        before,
        after: content,
        toolName: "modify_file",
      },
      status: "pending",
    });

    return `Staged file modification: ${key}`;
  }

  // 7b. editFile (surgical search-and-replace)
  editFile(
    rel: string,
    oldText: string,
    newText: string,
    replaceAll = false,
  ): string {
    if (!this.config.tools.allowFileModification) {
      throw new Error("edit_file: file modification is disabled in this mode");
    }

    this.assertNotExcluded(rel, "edit_file");

    if (!oldText) {
      throw new Error("edit_file: old_text must not be empty");
    }

    const key = this.norm(rel);
    const before = this.getEffectiveText(key);

    if (before === undefined) {
      throw new Error(`edit_file: file not found: ${rel}`);
    }

    const occurrences = before.split(oldText).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `edit_file: target text not found in ${rel}. Read the file first to match exact content.`,
      );
    }

    if (occurrences > 1 && !replaceAll) {
      throw new Error(
        `edit_file: target text matched ${occurrences} times in ${rel}. Provide more surrounding context or set replace_all=true.`,
      );
    }

    const after = replaceAll
      ? before.split(oldText).join(newText)
      : before.replace(oldText, newText);

    this.overlay.set(key, after);
    this.deleted.delete(key);

    this.tracker.log({
      type: "file_modify",
      path: key,
      details: {
        before,
        after,
        toolName: "edit_file",
      },
      status: "pending",
    });

    return `Staged edit in ${key} (${replaceAll ? occurrences : 1} replacement${occurrences > 1 && replaceAll ? "s" : ""})`;
  }

  // 8. deleteFile (captures before content for accurate diff viewing)
  deleteFile(rel: string): string {
    if (!this.config.tools.allowFileModification) {
      throw new Error("delete_file: file deletion is disabled in this mode");
    }

    this.assertNotExcluded(rel, "delete_file");

    const key = this.norm(rel);
    const before = this.getEffectiveText(key);

    if (before === undefined) {
      const abs = this.resolveSafe(key);
      if (!fs.existsSync(abs)) {
        throw new Error(`delete_file: file not found: ${rel}`);
      }
    }

    this.deleted.add(key);
    this.overlay.delete(key);

    this.tracker.log({
      type: "file_delete",
      path: key,
      details: {
        before: before ?? "",
        toolName: "delete_file",
      },
      status: "pending",
    });

    return `Staged file deletion: ${key}`;
  }

  // 9. createFolder
  createFolder(rel: string): string {
    if (!this.config.tools.allowFolderCreation) {
      throw new Error("create_folder: folder creation is disabled in this mode");
    }

    this.assertNotExcluded(rel, "create_folder");

    const key = this.norm(rel);
    const abs = this.resolveSafe(key);

    if (fs.existsSync(abs)) {
      throw new Error(`create_folder: already exists: ${rel}`);
    }

    this.tracker.log({
      type: "folder_create",
      path: key,
      details: {
        toolName: "create_folder",
      },
      status: "pending",
    });

    return `Staged folder creation: ${key}`;
  }

  // 10. listFiles
  listFiles(rel: string, recursive: boolean): string {
    this.assertNotExcluded(rel, "list_files");

    const root = this.resolveSafe(rel);

    if (!fs.existsSync(root)) {
      throw new Error(`list_files: path not found: ${rel}`);
    }

    const results: string[] = [];

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const relative = path
          .relative(this.config.codebasePath, full)
          .split(path.sep)
          .join("/");

        if (this.excluded(relative)) {
          continue;
        }

        results.push(ent.isDirectory() ? `${relative}/` : relative);

        if (recursive && ent.isDirectory()) {
          walk(full);
        }
      }
    };

    if (fs.statSync(root).isDirectory()) {
      walk(root);
    } else {
      const relative = path
        .relative(this.config.codebasePath, root)
        .split(path.sep)
        .join("/");

      results.push(relative);
    }

    const out = results.sort().join("\n");

    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: {
        after: out || "(none)",
        toolName: "list_files",
      },
      status: "executed",
    });

    return out || "(none)";
  }

  // 11. searchFiles (fixed glob matching + line-number matches for content queries)
  searchFiles(
    rootRel: string,
    globPattern: string,
    contentQuery?: string,
  ): string {
    this.assertNotExcluded(rootRel, "search_files");

    const rootAbs = this.resolveSafe(rootRel);

    if (!fs.existsSync(rootAbs)) {
      throw new Error(`search_files: root not found: ${rootRel}`);
    }

    const results: string[] = [];
    const nameRe = globToRegExp(globPattern);
    const MAX_MATCHES = 100;

    const inspectFile = (full: string, rel: string) => {
      if (results.length >= MAX_MATCHES) return;

      if (!contentQuery) {
        results.push(rel);
        return;
      }

      if (!isProbablyTextFile(full)) return;

      const stat = fs.statSync(full);
      if (stat.size > this.config.maxFileSizeToRead) return;

      const text = fs.readFileSync(full, "utf8");
      const queryLower = contentQuery.toLowerCase();
      const lines = text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_MATCHES) break;
        const line = lines[i]!;
        if (line.toLowerCase().includes(queryLower)) {
          const preview = line.trim().slice(0, 120);
          results.push(`${rel}:${i + 1}: ${preview}`);
        }
      }
    };

    const walk = (dir: string) => {
      if (results.length >= MAX_MATCHES) return;

      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (results.length >= MAX_MATCHES) break;
        const full = path.join(dir, ent.name);
        const rel = path
          .relative(this.config.codebasePath, full)
          .split(path.sep)
          .join("/");

        if (this.excluded(rel)) {
          continue;
        }

        if (ent.isDirectory()) {
          walk(full);
        } else if (nameRe.test(rel) || nameRe.test(ent.name)) {
          inspectFile(full, rel);
        }
      }
    };

    if (fs.statSync(rootAbs).isDirectory()) {
      walk(rootAbs);
    } else {
      const rel = path
        .relative(this.config.codebasePath, rootAbs)
        .split(path.sep)
        .join("/");
      inspectFile(rootAbs, rel);
    }

    const unique = [...new Set(results)];
    const truncatedNotice =
      unique.length >= MAX_MATCHES ? `\n... (capped at ${MAX_MATCHES} matches)` : "";
    const out = unique.join("\n") + truncatedNotice;

    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: {
        after: out || "(no matches)",
        toolName: "search_files",
      },
      status: "executed",
    });

    return out || "(no matches)";
  }

  // 12. analyzeCodebase (file count, dirs, total size, extension breakdown)
  analyzeCodebase(rootRel: string): string {
    this.assertNotExcluded(rootRel, "analyze_codebase");
    const rootAbs = this.resolveSafe(rootRel);

    if (!fs.existsSync(rootAbs)) {
      throw new Error(`analyze_codebase: not found: ${rootRel}`);
    }

    let files = 0;
    let dirs = 0;
    let totalBytes = 0;
    const extCounts = new Map<string, number>();

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        const rel = path
          .relative(this.config.codebasePath, full)
          .split(path.sep)
          .join("/");

        if (this.excluded(rel)) {
          continue;
        }

        if (ent.isDirectory()) {
          dirs++;
          walk(full);
        } else {
          files++;
          try {
            totalBytes += fs.statSync(full).size;
          } catch {
            // ignore unreadable stat
          }
          const ext = path.extname(ent.name).toLowerCase() || "(no ext)";
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        }
      }
    };

    if (fs.statSync(rootAbs).isDirectory()) {
      walk(rootAbs);
    } else {
      files = 1;
      totalBytes = fs.statSync(rootAbs).size;
      const ext = path.extname(rootAbs).toLowerCase() || "(no ext)";
      extCounts.set(ext, 1);
    }

    const topExts = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(", ");

    const summary = [
      `Files: ${files} | Directories: ${dirs} | Total Size: ${formatBytes(totalBytes)}`,
      topExts ? `Extensions: ${topExts}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: {
        after: summary,
        toolName: "analyze_codebase",
      },
      status: "executed",
    });

    return summary;
  }

  // 12b. Read-only Git inspection tools (safe argv invocation, no shell)
  private runGitReadOnly(args: string[], toolName: string): string {
    const r = spawnSync("git", args, {
      cwd: this.config.codebasePath,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });

    if (r.error) {
      return `git unavailable: ${r.error.message}`;
    }

    if (r.status !== 0) {
      return (r.stderr || r.stdout || `git exited with code ${r.status}`).trim();
    }

    const out = (r.stdout || "(clean / no output)").trim();
    const clipped =
      out.length > 8000 ? out.slice(0, 8000) + "\n...[truncated]" : out;

    this.tracker.log({
      type: "code_analysis",
      path: "git",
      details: {
        after: clipped,
        toolName,
      },
      status: "executed",
    });

    return clipped;
  }

  gitStatus(): string {
    return this.runGitReadOnly(["status", "--short", "--branch"], "git_status");
  }

  gitDiff(staged = false, filePath?: string): string {
    const args = ["diff"];
    if (staged) args.push("--staged");
    if (filePath) {
      this.assertNotExcluded(filePath, "git_diff");
      this.resolveSafe(filePath);
      args.push("--", this.norm(filePath));
    }
    return this.runGitReadOnly(args, "git_diff");
  }

  gitLog(limit = 10): string {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.runGitReadOnly(
      ["log", `-n`, String(safeLimit), "--oneline", "--decorate"],
      "git_log",
    );
  }

  // 13. queueShell
  queueShell(command: string): string {
    if (!this.config.tools.allowShellExecution) {
      throw new Error("Shell execution disabled");
    }

    this.tracker.log({
      type: "tool_execute",
      path: "shell",
      details: {
        command,
        toolName: "execute_shell",
      },
      status: "pending",
    });

    return `Shell command queued for approval: ${command}`;
  }

  // 14. skillRoots
  skillRoots(): string[] {
    const extra =
      process.env.SKILLS_DIRS?.split(/[;]/)
        .map((s) => s.trim())
        .filter(Boolean) ?? [];

    return [
      ...extra,
      path.join(homedir(), ".cursor/skills-cursor"),
      path.join(homedir(), ".claude/skills"),
    ];
  }

  // 15. listSkills
  listSkills(): string {
    const lines: string[] = [];

    for (const root of this.skillRoots()) {
      if (!fs.existsSync(root)) {
        continue;
      }

      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);

          if (ent.isDirectory()) {
            walk(full);
          } else if (ent.name === "SKILL.md") {
            lines.push(full);
          }
        }
      };

      walk(root);
    }

    const out = lines.sort().join("\n");

    this.tracker.log({
      type: "code_analysis",
      path: "skills",
      details: {
        after: out || "(none)",
        toolName: "list_skills",
      },
      status: "executed",
    });

    return out || "(none)";
  }

  // 16. readSkill
  readSkill(skillPath: string): string {
    const abs = path.isAbsolute(skillPath)
      ? path.normalize(skillPath)
      : path.normalize(path.resolve(this.config.codebasePath, skillPath));

    const allowed = this.skillRoots().some((root) => {
      const r = path.resolve(root);
      return abs === r || abs.startsWith(r + path.sep);
    });

    if (!allowed) {
      throw new Error("read_skill: outside skill roots");
    }

    if (!fs.existsSync(abs)) {
      throw new Error(`read_skill: not found: ${skillPath}`);
    }

    const text = fs.readFileSync(abs, "utf8");

    this.tracker.log({
      type: "code_analysis",
      path: abs,
      details: {
        after: text,
        toolName: "read_skill",
      },
      status: "executed",
    });

    return text;
  }

  // 17. applyApprovedFromTracker (saves undo snapshot + captures shell stdout/stderr)
  applyApprovedFromTracker(): ApplyResult {
    const errors: string[] = [];
    const outputs: ShellExecutionOutput[] = [];
    let appliedCount = 0;

    const all = [...this.tracker.getActions()];

    const approvedFolders = all.filter(
      (x) => x.type === "folder_create" && x.status === "approved",
    );

    const fileOps = all
      .filter(
        (a) =>
          (a.type === "file_create" ||
            a.type === "file_modify" ||
            a.type === "file_delete") &&
          a.status === "approved",
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const lastByPath = new Map<string, ActionLog>();
    for (const a of fileOps) {
      lastByPath.set(this.norm(a.path), a);
    }

    // Save undo snapshot before mutating disk
    let undoBatchId: string | undefined;
    try {
      undoBatchId = this.undoManager.saveSnapshot(
        [...lastByPath.keys()],
        approvedFolders.map((f) => this.norm(f.path)),
      );
    } catch (e) {
      errors.push(`Failed to save undo snapshot: ${String(e)}`);
    }

    // Create approved folders
    for (const a of approvedFolders) {
      try {
        fs.mkdirSync(this.resolveSafe(a.path), { recursive: true });
        appliedCount++;
      } catch (e) {
        errors.push(`folder_create (${a.path}): ${String(e)}`);
      }
    }

    // Apply approved file operations
    for (const [p, a] of lastByPath) {
      try {
        if (a.type === "file_delete") {
          fs.rmSync(this.resolveSafe(p), { force: true });
        } else {
          const target = this.resolveSafe(p);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, a.details.after ?? "", "utf8");
        }
        appliedCount++;
      } catch (e) {
        errors.push(`${a.type} (${p}): ${String(e)}`);
      }
    }

    // Execute approved shell commands
    for (const a of all.filter(
      (x) => x.type === "tool_execute" && x.status === "approved",
    )) {
      const cmd = a.details.command;
      if (!cmd) continue;

      const r = spawnSync(cmd, {
        shell: true,
        cwd: this.config.codebasePath,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });

      const stdout = (r.stdout ?? "").trim();
      const stderr = (r.stderr ?? "").trim();

      outputs.push({
        command: cmd,
        exitCode: r.status,
        stdout,
        stderr,
      });

      appliedCount++;

      if (r.error) {
        errors.push(`shell error (${cmd}): ${r.error.message}`);
      } else if (r.status !== null && r.status !== 0) {
        const detail = stderr ? ` — ${stderr.slice(0, 300)}` : "";
        errors.push(`shell exit ${r.status}: ${cmd}${detail}`);
      }
    }

    return { errors, outputs, appliedCount, undoBatchId };
  }

  clearStaging(): void {
    this.overlay.clear();
    this.deleted.clear();
  }
}
