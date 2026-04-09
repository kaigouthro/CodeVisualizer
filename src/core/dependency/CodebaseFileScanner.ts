import * as path from "path";
import { FileSystemAdapter } from "./FileSystemAdapter";

export interface FileScannerOptions {
  supportedExtensions: Set<string>;
  ignoredDirectories?: Set<string>;
  ignoreHidden?: boolean;
}

export class CodebaseFileScanner {
  private readonly ignoredDirectories: Set<string>;
  private readonly ignoreHidden: boolean;

  constructor(
    private readonly fileSystem: FileSystemAdapter,
    private readonly workspaceRoot: string,
    private readonly options: FileScannerOptions
  ) {
    this.ignoredDirectories = options.ignoredDirectories ??
      new Set(["node_modules", "dist", "build", ".git"]);
    this.ignoreHidden = options.ignoreHidden ?? true;
  }

  public async getAllSupportedFiles(): Promise<string[]> {
    return this.walkForSupportedFiles(this.workspaceRoot);
  }

  public async getFilesFromPaths(selectedPaths: string[]): Promise<string[]> {
    const files = new Set<string>();

    for (const selectedPath of selectedPaths) {
      // Resolve realpath to guard against symlink escapes, then clamp to workspace
      let resolvedPath: string;
      try {
        resolvedPath = await this.fileSystem.realpath(selectedPath);
      } catch {
        // Path doesn't exist or can't be resolved; skip
        continue;
      }

      const rel = path.relative(this.workspaceRoot, resolvedPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        // Path escapes the workspace root; skip
        continue;
      }

      let stat;
      try {
        stat = await this.fileSystem.stat(resolvedPath);
      } catch {
        continue;
      }

      if (stat.isFile()) {
        if (this.isSupportedFile(resolvedPath)) {
          files.add(resolvedPath);
        }
        continue;
      }

      if (stat.isDirectory()) {
        const dirFiles = await this.walkForSupportedFiles(resolvedPath);
        for (const filePath of dirFiles) {
          files.add(filePath);
        }
      }
    }

    return [...files];
  }

  private async walkForSupportedFiles(rootDir: string): Promise<string[]> {
    const files: string[] = [];

    const walkDir = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await this.fileSystem.readDir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (this.shouldSkipEntry(entry.name)) {
          continue;
        }

        if (entry.isDirectory) {
          await walkDir(entry.fullPath);
          continue;
        }

        if (entry.isFile && this.isSupportedFile(entry.fullPath)) {
          files.push(entry.fullPath);
        }
      }
    };

    await walkDir(rootDir);
    return files;
  }

  private isSupportedFile(filePath: string): boolean {
    return this.options.supportedExtensions.has(path.extname(filePath));
  }

  private shouldSkipEntry(entryName: string): boolean {
    if (this.ignoredDirectories.has(entryName)) {
      return true;
    }

    if (this.ignoreHidden && entryName.startsWith(".")) {
      return true;
    }

    return false;
  }
}
