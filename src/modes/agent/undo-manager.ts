import fs from "node:fs";
import path from "node:path";

export interface UndoFileEntry {
  relPath: string;
  existed: boolean;
  previousContent?: string;
}

export interface UndoBatch {
  id: string;
  createdAt: string;
  files: UndoFileEntry[];
  createdFolders: string[];
}

export interface UndoResult {
  success: boolean;
  batchId?: string;
  restored: string[];
  removed: string[];
  errors: string[];
  message: string;
}

const MAX_UNDO_BATCHES = 20;

export class UndoManager {
  private readonly undoDir: string;

  constructor(private readonly codebasePath: string) {
    this.undoDir = path.join(path.resolve(codebasePath), ".krypton", "undo");
  }

  private resolveSafe(relPath: string): string {
    const base = path.resolve(this.codebasePath);
    const target = path.resolve(base, relPath);
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error(`Undo path escapes codebase: ${relPath}`);
    }
    return target;
  }

  saveSnapshot(filePaths: string[], createdFolders: string[] = []): string | undefined {
    const uniqueFiles = [...new Set(filePaths)];
    const uniqueFolders = [...new Set(createdFolders)];

    if (uniqueFiles.length === 0 && uniqueFolders.length === 0) {
      return undefined;
    }

    fs.mkdirSync(this.undoDir, { recursive: true });

    const files: UndoFileEntry[] = uniqueFiles.map((relPath) => {
      const abs = this.resolveSafe(relPath);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return {
          relPath,
          existed: true,
          previousContent: fs.readFileSync(abs, "utf8"),
        };
      }
      return {
        relPath,
        existed: false,
      };
    });

    const newFolders = uniqueFolders.filter((relFolder) => {
      const abs = this.resolveSafe(relFolder);
      return !fs.existsSync(abs);
    });

    const id = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const batch: UndoBatch = {
      id,
      createdAt: new Date().toISOString(),
      files,
      createdFolders: newFolders,
    };

    const batchFile = path.join(this.undoDir, `${id}.json`);
    fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2), "utf8");

    this.pruneOldBatches();
    return id;
  }

  private listBatchFiles(): string[] {
    if (!fs.existsSync(this.undoDir)) return [];
    return fs
      .readdirSync(this.undoDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
  }

  private pruneOldBatches(): void {
    const files = this.listBatchFiles();
    if (files.length <= MAX_UNDO_BATCHES) return;
    const toRemove = files.slice(0, files.length - MAX_UNDO_BATCHES);
    for (const f of toRemove) {
      fs.rmSync(path.join(this.undoDir, f), { force: true });
    }
  }

  listHistory(): UndoBatch[] {
    const files = this.listBatchFiles().reverse();
    const batches: UndoBatch[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(this.undoDir, f), "utf8");
        batches.push(JSON.parse(raw) as UndoBatch);
      } catch {
        // Skip corrupted snapshot files
      }
    }
    return batches;
  }

  undoLastBatch(): UndoResult {
    const files = this.listBatchFiles();
    if (files.length === 0) {
      return {
        success: false,
        restored: [],
        removed: [],
        errors: [],
        message: "No saved changes available to undo.",
      };
    }

    const latestFile = files[files.length - 1]!;
    const fullPath = path.join(this.undoDir, latestFile);

    let batch: UndoBatch;
    try {
      batch = JSON.parse(fs.readFileSync(fullPath, "utf8")) as UndoBatch;
    } catch (e) {
      return {
        success: false,
        restored: [],
        removed: [],
        errors: [String(e)],
        message: "Failed to read the latest undo snapshot.",
      };
    }

    const restored: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];

    for (const entry of batch.files) {
      try {
        const abs = this.resolveSafe(entry.relPath);
        if (entry.existed) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, entry.previousContent ?? "", "utf8");
          restored.push(entry.relPath);
        } else {
          if (fs.existsSync(abs)) {
            fs.rmSync(abs, { force: true });
            removed.push(entry.relPath);
          }
        }
      } catch (e) {
        errors.push(`${entry.relPath}: ${String(e)}`);
      }
    }

    // Remove newly created folders only if empty (deepest first)
    const sortedFolders = [...batch.createdFolders].sort(
      (a, b) => b.length - a.length,
    );
    for (const relFolder of sortedFolders) {
      try {
        const abs = this.resolveSafe(relFolder);
        if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) {
          fs.rmdirSync(abs);
          removed.push(`${relFolder}/`);
        }
      } catch {
        // Keep non-empty folder safely
      }
    }

    fs.rmSync(fullPath, { force: true });

    const summaryParts: string[] = [];
    if (restored.length) summaryParts.push(`restored ${restored.length} file(s)`);
    if (removed.length) summaryParts.push(`removed ${removed.length} created item(s)`);
    const summary =
      summaryParts.length > 0 ? summaryParts.join(", ") : "no file changes to revert";

    return {
      success: errors.length === 0,
      batchId: batch.id,
      restored,
      removed,
      errors,
      message: `Undid batch ${batch.id}: ${summary}.`,
    };
  }
}
