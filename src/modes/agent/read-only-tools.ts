import { tool } from "ai";
import { z } from "zod";
import type { ToolExecutor } from "./tool-executor";

export function createReadOnlyTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description:
        "Read a file from the codebase (relative to project root). Optionally pass start_line and end_line for large files.",
      inputSchema: z.object({
        path: z.string().describe("Relative path to the file to read"),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      }),
      execute: async ({ path: p, start_line, end_line }) =>
        executor.readFile(p, start_line, end_line),
    }),

    list_files: tool({
      description: "List files and directories under a relative path.",
      inputSchema: z.object({
        path: z.string().default("."),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) =>
        executor.listFiles(p, recursive),
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content_contains substring search returns matching line numbers.',
      inputSchema: z.object({
        root: z.string().default(".").describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob pattern using *, **, and ? (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) =>
        executor.searchFiles(root, pattern, content_contains),
    }),

    analyze_codebase: tool({
      description:
        "Summarize codebase structure: file counts, directory counts, total size, and top file extensions.",
      inputSchema: z.object({
        path: z.string().default("."),
      }),
      execute: async ({ path: p }) => executor.analyzeCodebase(p),
    }),

    git_status: tool({
      description: "Show current git branch and working tree status (read-only).",
      inputSchema: z.object({}),
      execute: async () => executor.gitStatus(),
    }),

    git_diff: tool({
      description: "Show git diff for working tree or staged changes (read-only).",
      inputSchema: z.object({
        staged: z.boolean().optional().default(false),
        path: z.string().optional().describe("Optional relative file path"),
      }),
      execute: async ({ staged, path: p }) => executor.gitDiff(staged, p),
    }),

    git_log: tool({
      description: "Show recent git commit history (read-only).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().default(10),
      }),
      execute: async ({ limit }) => executor.gitLog(limit),
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => executor.listSkills(),
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or from list_skills.",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.readSkill(p),
    }),
  };
}
