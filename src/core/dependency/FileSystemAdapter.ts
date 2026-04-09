import * as fs from "fs";
import * as path from "path";

export interface DirectoryEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileSystemAdapter {
  readDir(dirPath: string): Promise<DirectoryEntry[]>;
  readFile(filePath: string): Promise<string>;
  stat(filePath: string): Promise<fs.Stats>;
  exists(filePath: string): Promise<boolean>;
}

export class NodeFileSystemAdapter implements FileSystemAdapter {
  public async readDir(dirPath: string): Promise<DirectoryEntry[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      fullPath: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  public async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, "utf-8");
  }

  public async stat(filePath: string): Promise<fs.Stats> {
    return fs.promises.stat(filePath);
  }

  public async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
