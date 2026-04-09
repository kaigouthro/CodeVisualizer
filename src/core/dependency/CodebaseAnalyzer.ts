import * as path from "path";
import { FileCategory, FileTypeClassifier } from "./FileTypeClassifier";
import { CodebaseFileScanner } from "./CodebaseFileScanner";
import { FileSystemAdapter, NodeFileSystemAdapter } from "./FileSystemAdapter";

export interface CodebaseModule{
  source: string; // Absolute path to file
  relativePath: string; // Relative path from workspace root
  fileName: string; // Just the filename
  languageId: string;
  fileCategory: FileCategory; // File category for color coding
  dependencies: CodebaseDependency[]; // Files this module imports/requires
  dependents: string[]; // Files that import/require this module
  functions: string[]; // Functions defined in this file
  exports: string[]; // Exported functions/classes
}

export interface CodebaseDependency{
  module: string; // Import path as written in code
  resolved: string | null; // Resolved absolute path (null if not resolvable)
  dependencyTypes: string[]; // e.g., "import", "require", "dynamic"
  valid: boolean; // Whether the dependency could be resolved
}

export const DEFAULT_SUPPORTED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".java", ".cpp", ".c", ".h", ".hpp",
  ".rs", ".go",
]);

export interface CodebaseAnalyzerOptions {
  fileSystem?: FileSystemAdapter;
  supportedExtensions?: Set<string>;
}

export class CodebaseAnalyzer {
  private readonly modules: Map<string, CodebaseModule> = new Map();
  private readonly supportedExtensions: Set<string>;
  private readonly scanner: CodebaseFileScanner;
  private readonly fileSystem: FileSystemAdapter;

  constructor(
    private readonly workspaceRoot: string,
    options: CodebaseAnalyzerOptions = {}
  ) {
    this.fileSystem = options.fileSystem ?? new NodeFileSystemAdapter();
    this.supportedExtensions = options.supportedExtensions ?? DEFAULT_SUPPORTED_EXTENSIONS;
    this.scanner = new CodebaseFileScanner(this.fileSystem, this.workspaceRoot, {
      supportedExtensions: this.supportedExtensions,
    });
  }

  public async analyzeCodebase(
    selectedPaths?: string[]
  ): Promise<Map<string, CodebaseModule>> {
    this.modules.clear();

    const filesToAnalyze = selectedPaths
      ? await this.scanner.getFilesFromPaths(selectedPaths)
      : await this.scanner.getAllSupportedFiles();

    for (const filePath of filesToAnalyze) {
      try {
        const module = await this.analyzeFile(filePath);
        if (module) {
          this.modules.set(module.source, module);
        }
      } catch (error) {
        console.error(`Error analyzing ${filePath}:`, error);
      }
    }

    this.resolveDependencies();

    return this.modules;
  }

  private async analyzeFile(filePath: string): Promise<CodebaseModule | null> {
    try {
      const content = await this.fileSystem.readFile(filePath);
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath);
      const languageId = this.getLanguageId(ext);

      const dependencies = await this.extractDependencies(content, filePath, languageId);
      const functions = this.extractFunctions(content, languageId);
      const exports = this.extractExports(content, languageId);
      const fileCategory = FileTypeClassifier.classifyFile(relativePath, fileName);

      return {
        source: filePath,
        relativePath,
        fileName,
        languageId,
        fileCategory,
        dependencies,
        dependents: [],
        functions,
        exports,
      };
    } catch (error){
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  private async extractDependencies(
    content: string,
    filePath: string,
    languageId: string
  ): Promise<CodebaseDependency[]> {
    const dependencies: CodebaseDependency[] = [];

    if (languageId === "typescript" || languageId === "javascript") {
      const importRegex = /import\s+(?:(?:\*\s+as\s+\w+)|(?:\{[^}]*\})|(?:\w+))\s+from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const modulePath = match[1];
        const resolved = await this.resolveModulePath(modulePath, filePath);
        dependencies.push({
          module: modulePath,
          resolved,
          dependencyTypes: ["import"],
          valid: resolved !== null,
        });
      }

      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        const modulePath = match[1];
        const resolved = await this.resolveModulePath(modulePath, filePath);
        dependencies.push({
          module: modulePath,
          resolved,
          dependencyTypes: ["require"],
          valid: resolved !== null,
        });
      }
    } else if (languageId === "python") {
      const importRegex = /(?:^|\n)\s*(?:import|from)\s+([\w\.]+)/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const modulePath = match[1];
        const resolved = await this.resolvePythonModule(modulePath, filePath);
        dependencies.push({
          module: modulePath,
          resolved,
          dependencyTypes: ["import"],
          valid: resolved !== null,
        });
      }
    }

    return dependencies;
  }

  private async resolveModulePath(modulePath: string, fromFile: string): Promise<string | null> {
    if (!modulePath.startsWith(".") && !modulePath.startsWith("/")) {
      return null;
    }

    const fromDir = path.dirname(fromFile);

    try {
      const resolved = modulePath.startsWith("/")
        ? path.join(this.workspaceRoot, modulePath)
        : path.resolve(fromDir, modulePath);

      const extensions = ["", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        const stat = await this.safeStat(withExt);
        if (stat?.isFile()) {
          return withExt;
        }
      }

      const indexExtensions = ["index.js", "index.ts", "index.jsx", "index.tsx"];
      for (const indexExt of indexExtensions) {
        const indexPath = path.join(resolved, indexExt);
        const stat = await this.safeStat(indexPath);
        if (stat?.isFile()) {
          return indexPath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async resolvePythonModule(modulePath: string, fromFile: string): Promise<string | null> {
    const fromDir = path.dirname(fromFile);

    try {
      const pythonPath = modulePath.replace(/\./g, path.sep);
      const localRelativePath = path.resolve(fromDir, pythonPath);
      const workspaceRelativePath = path.resolve(this.workspaceRoot, pythonPath);
      const candidateBases = modulePath.startsWith(".")
        ? [localRelativePath]
        : [localRelativePath, workspaceRelativePath];

      for (const basePath of candidateBases) {
        const withExt = basePath + ".py";
        const withExtStat = await this.safeStat(withExt);
        if (withExtStat?.isFile()) {
          return withExt;
        }

        const initPath = path.join(basePath, "__init__.py");
        const initStat = await this.safeStat(initPath);
        if (initStat?.isFile()) {
          return initPath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private extractFunctions(content: string, languageId: string): string[] {
    const functions: string[] = [];

    if (languageId === "typescript" || languageId === "javascript") {
      const funcDeclRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = funcDeclRegex.exec(content)) !== null) {
        functions.push(match[1]);
      }

      const arrowFuncRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:async\s*)?\(/g;
      while ((match = arrowFuncRegex.exec(content)) !== null) {
        functions.push(match[1]);
      }

      const methodRegex = /(?:public\s+|private\s+|protected\s+)?(\w+)\s*\(/g;
      while ((match = methodRegex.exec(content)) !== null) {
        if (!functions.includes(match[1])) {
          functions.push(match[1]);
        }
      }
    } else if (languageId === "python") {
      const funcRegex = /def\s+(\w+)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = funcRegex.exec(content)) !== null) {
        functions.push(match[1]);
      }
    }

    return functions;
  }

  private extractExports(content: string, languageId: string): string[] {
    const exports: string[] = [];

    if (languageId === "typescript" || languageId === "javascript") {
      const exportRegex = /export\s+(?:function|const|let|class|async\s+function)\s+(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = exportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }
    } else if (languageId === "python") {
      const allRegex = /__all__\s*=\s*\[([^\]]+)\]/;
      const match = content.match(allRegex);
      if (match) {
        const items = match[1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
        exports.push(...items);
      }
    }

    return exports;
  }

  private resolveDependencies(): void {
    for (const [source, module] of this.modules.entries()) {
      for (const dep of module.dependencies) {
        if (dep.resolved && this.modules.has(dep.resolved)) {
          const dependentModule = this.modules.get(dep.resolved)!;
          if (!dependentModule.dependents.includes(source)) {
            dependentModule.dependents.push(source);
          }
        }
      }
    }
  }

  private getLanguageId(ext: string): string {
    const langMap: Record<string, string> = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".java": "java",
      ".cpp": "cpp",
      ".cxx": "cpp",
      ".cc": "cpp",
      ".c": "c",
      ".h": "c",
      ".hpp": "cpp",
      ".rs": "rust",
      ".go": "go",
    };
    return langMap[ext] || "unknown";
  }

  private async safeStat(filePath: string) {
    try {
      return await this.fileSystem.stat(filePath);
    } catch {
      return null;
    }
  }

  public getModules(): Map<string, CodebaseModule> {
    return this.modules;
  }
}
