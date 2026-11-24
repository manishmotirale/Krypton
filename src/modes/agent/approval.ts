import type { ActionTracker } from "./action-tracker";
import type { ActionLog, ApplyResult } from "./types";
import chalk from "chalk";
import { select, isCancel } from "@clack/prompts";
import { composeBeforeAfter, formatPatch } from "./diff-view";
import { renderTerminalMarkdown } from "../../ui/terminal-md";

interface ReviewGroup {
  label: string;
  actionIds: string[];
  patch: string | null;
}

function groupPending(pending: ActionLog[]): ReviewGroup[] {
  const byPath = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === "tool_execute") {
      shells.push(a);
      continue;
    }

    const key = a.path;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(a);
  }

  const groups: ReviewGroup[] = [];

  const pathEntries = [...byPath.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  for (const [p, acts] of pathEntries) {
    const sorted = acts.sort(
      (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
    );

    const ids = sorted.map((x) => x.id);

    if (sorted.every((x) => x.type === "folder_create")) {
      groups.push({
        label: `Create folder: ${p}`,
        actionIds: ids,
        patch: null,
      });
      continue;
    }

    const { before, after } = composeBeforeAfter(sorted);
    const patch = formatPatch(p, before, after);
    const kinds = [...new Set(sorted.map((x) => x.type.replace(/_/g, " ")))]
      .join(", ");

    groups.push({
      label: `${p} (${kinds})`,
      actionIds: ids,
      patch,
    });
  }

  for (const s of shells) {
    groups.push({
      label: `Shell: ${s.details.command ?? "(no command)"}`,
      actionIds: [s.id],
      patch: null,
    });
  }

  return groups;
}

function printStagedSummary(groups: ReviewGroup[]): void {
  console.log(chalk.bold.cyan("\n📦 Staged Changes Summary:"));
  for (const [idx, g] of groups.entries()) {
    console.log(chalk.white(`  ${idx + 1}. ${g.label}`));
  }
  console.log();
}

export function printApplyResult(result: ApplyResult): void {
  for (const out of result.outputs) {
    console.log(chalk.bold.cyan(`\n💻 Shell: ${out.command}`));
    if (out.stdout) {
      console.log(chalk.gray(out.stdout));
    }
    if (out.stderr) {
      console.log(chalk.yellow(out.stderr));
    }
  }

  if (result.errors.length) {
    console.log(chalk.red("\n❌ Some operations reported errors:\n"));
    for (const error of result.errors) {
      console.log(chalk.red(`  • ${error}`));
    }
  } else {
    console.log(
      chalk.green(`\n✓ Applied ${result.appliedCount} operation(s) successfully.`),
    );
  }

  if (result.undoBatchId) {
    console.log(
      chalk.dim(
        `  Tip: Run \`krypton undo\` (or select Undo in the menu) to revert this batch.\n`,
      ),
    );
  }
}

export async function runApprovalFlow(
  tracker: ActionTracker,
): Promise<boolean> {
  const pending = tracker.getPendingMutations();
  if (pending.length === 0) {
    console.log(chalk.dim("\nNo pending file or shell changes to apply.\n"));
    return false;
  }

  const groups = groupPending(pending);
  printStagedSummary(groups);

  const choice = await select({
    message: `Apply ${groups.length} staged change group(s)?`,
    options: [
      { value: "all", label: "Approve and apply all changes" },
      { value: "diff_all", label: "Preview all diffs first" },
      { value: "select", label: "Review one by one" },
      { value: "cancel", label: "Reject all and cancel" },
    ],
  });

  if (isCancel(choice) || choice === "cancel") {
    for (const act of pending) {
      tracker.updateStatus(act.id, "rejected", false);
    }
    console.log(chalk.yellow("\nStaged changes discarded.\n"));
    return false;
  }

  if (choice === "diff_all") {
    for (const group of groups) {
      console.log(chalk.bold.cyan(`\n─── ${group.label} ───`));
      if (group.patch) {
        console.log(
          renderTerminalMarkdown("```diff\n" + group.patch + "\n```\n"),
        );
      } else {
        console.log(chalk.dim("  (no text diff)\n"));
      }
    }
    // Re-run prompt after previewing diffs
    return runApprovalFlow(tracker);
  }

  if (choice === "all") {
    for (const act of pending) {
      tracker.updateStatus(act.id, "approved", true);
    }
    return true;
  }

  for (const group of groups) {
    while (true) {
      const opt = await select({
        message: chalk.bold(group.label),
        options: [
          { value: "accept", label: "Accept" },
          {
            value: "diff",
            label: "Show Diff",
            hint: group.patch ? "View unified diff" : "N/A",
          },
          { value: "reject", label: "Reject" },
        ],
      });

      if (isCancel(opt)) {
        for (const act of pending) {
          tracker.updateStatus(act.id, "rejected", false);
        }
        return false;
      }

      if (opt === "diff") {
        if (group.patch) {
          console.log(
            "\n" +
              renderTerminalMarkdown("```diff\n" + group.patch + "\n```\n") +
              "\n",
          );
        } else {
          console.log(chalk.dim("\nNo text diff available for this action.\n"));
        }
        continue;
      }

      for (const act of group.actionIds) {
        tracker.updateStatus(
          act,
          opt === "accept" ? "approved" : "rejected",
          opt === "accept",
        );
      }
      break;
    }
  }

  return tracker.getActions().some((a) => a.status === "approved");
}
