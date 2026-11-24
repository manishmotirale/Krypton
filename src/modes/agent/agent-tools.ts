import { tool } from "ai";
import { z } from "zod";
import { ToolExecutor } from "./tool-executor";
import { createReadOnlyTools } from "./read-only-tools";

export function createAgentTools(executor: ToolExecutor) {
  return {
    ...createReadOnlyTools(executor),

    create_file: tool({
      description:
        "Stage creation of a new file (not written until the user approves).",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path: p, content }) => executor.createFile(p, content),
    }),

    edit_file: tool({
      description:
        "Stage a surgical search-and-replace edit on an existing file (preferred over modify_file for targeted changes; pending approval).",
      inputSchema: z.object({
        path: z.string().describe("Relative path to the existing file"),
        old_text: z.string().describe("Exact text block to find and replace"),
        new_text: z.string().describe("Replacement text"),
        replace_all: z
          .boolean()
          .optional()
          .default(false)
          .describe("Replace all occurrences instead of requiring a single match"),
      }),
      execute: async ({ path: p, old_text, new_text, replace_all }) =>
        executor.editFile(p, old_text, new_text, replace_all),
    }),

    modify_file: tool({
      description:
        "Stage a full-file replacement for an existing file (pending approval). Prefer edit_file for small edits.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().describe("Complete new file contents"),
      }),
      execute: async ({ path: p, content }) => executor.modifyFile(p, content),
    }),

    delete_file: tool({
      description: "Stage deletion of a file (pending approval).",
      inputSchema: z.object({
        path: z.string(),
      }),
      execute: async ({ path: p }) => executor.deleteFile(p),
    }),

    create_folder: tool({
      description:
        "Stage creation of a directory tree (pending approval). Uses mkdir -p on apply.",
      inputSchema: z.object({
        path: z.string().describe("Relative directory path"),
      }),
      execute: async ({ path: p }) => executor.createFolder(p),
    }),

    execute_shell: tool({
      description:
        "Queue a shell command to run in the workspace after user approval.",
      inputSchema: z.object({
        command: z.string().describe("Single shell command to execute on approval"),
      }),
      execute: async ({ command }) => executor.queueShell(command),
    }),
  };
}
