import { createTwoFilesPatch } from "diff";
import type { ActionLog } from "./types";

export function formatPatch(
  filePath: string,
  before: string,
  after: string,
): string {
  return createTwoFilesPatch(filePath, filePath, before, after, "", "", {
    context: 3,
  });
}

export function composeBeforeAfter(sorted: ActionLog[]): {
  before: string;
  after: string;
} {
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const before =
    first.type === "file_create" ? "" : (first.details.before ?? "");

  if (last.type === "file_delete") {
    return {
      before: before || (last.details.before ?? ""),
      after: "",
    };
  }

  const after = last.details.after ?? "";

  return { before, after };
}
