import { CodebaseModule } from "./CodebaseAnalyzer";
import { CodebaseMermaidGenerator } from "./CodebaseMermaidGenerator";

export class CodebaseGraphBuilder {
  private modules: Map<string, CodebaseModule>;
  private workspaceRoot: string;

  constructor(modules: Map<string, CodebaseModule>, workspaceRoot: string) {
    this.modules = modules;
    this.workspaceRoot = workspaceRoot;
  }

  public generateMermaid(): string {
    const generator = new CodebaseMermaidGenerator(this.modules, this.workspaceRoot, true);
    return generator.generate();
  }

}

