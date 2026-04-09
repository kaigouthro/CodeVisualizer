import { FlowchartIR } from "../ir/ir";
import { analyzePythonCode } from "./language-services/python";
import { analyzeTypeScriptCode } from "./language-services/typescript";
import { analyzeJavaCode } from "./language-services/java";
import { analyzeCppCode } from "./language-services/cpp";
import { analyzeCCode } from "./language-services/c";
import { analyzeRustCode } from "./language-services/rust";
import { analyzeGoCode } from "./language-services/go";

export type LanguageAnalyzer = (
  sourceCode: string,
  functionName?: string,
  position?: number
) => Promise<FlowchartIR>;

/**
 * Registry used to keep language-specific analyzers decoupled from the dispatch layer.
 * This makes the analysis entrypoint portable to non-VSCode runtimes.
 */
const languageAnalyzerRegistry: Map<string, LanguageAnalyzer> = new Map();

function registerDefaultAnalyzers(): void {
  registerLanguageAnalyzer("python", async (sourceCode, _functionName, position) =>
    analyzePythonCode(sourceCode, position ?? 0)
  );

  const tsAnalyzer: LanguageAnalyzer = async (sourceCode, _functionName, position) =>
    analyzeTypeScriptCode(sourceCode, position ?? 0);

  registerLanguageAnalyzer("typescript", tsAnalyzer);
  registerLanguageAnalyzer("javascript", tsAnalyzer);

  registerLanguageAnalyzer("java", async (sourceCode, _functionName, position) =>
    analyzeJavaCode(sourceCode, position ?? 0)
  );

  registerLanguageAnalyzer("cpp", async (sourceCode, functionName, position) =>
    analyzeCppCode(sourceCode, functionName, position)
  );

  registerLanguageAnalyzer("c", async (sourceCode, functionName, position) =>
    analyzeCCode(sourceCode, functionName, position)
  );

  registerLanguageAnalyzer("rust", async (sourceCode, functionName, position) =>
    analyzeRustCode(sourceCode, functionName, position)
  );

  registerLanguageAnalyzer("go", async (sourceCode, functionName, position) =>
    analyzeGoCode(sourceCode, functionName, position)
  );
}

registerDefaultAnalyzers();

export function registerLanguageAnalyzer(languageId: string, analyzer: LanguageAnalyzer): void {
  languageAnalyzerRegistry.set(languageId.toLowerCase(), analyzer);
}

/**
 * Analyzes the given source code and generates a flowchart.
 */
export async function analyzeCode(
  sourceCode: string,
  languageId: string,
  functionName?: string,
  position?: number
): Promise<FlowchartIR> {
  const analyzer = languageAnalyzerRegistry.get(languageId.toLowerCase());
  if (!analyzer) {
    throw new Error(`Unsupported language: ${languageId}`);
  }

  return analyzer(sourceCode, functionName, position);
}
