import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve, relative } from "path";
import { generateProjectMap } from "../graph/resolver";
import { type GetDB, resolveProject } from "./index";

export function registerGraphTools(server: McpServer, getDB: GetDB) {
  server.tool(
    "project_map",
    "Generate a structured dependency map of the project. Shows files, their exports, depends_on (imports), and depended_on_by (importers). Entry points are listed separately.",
    {
      directory: z
        .string()
        .optional()
        .describe("Project directory. Defaults to RAG_PROJECT_DIR env or cwd"),
      focus: z
        .string()
        .optional()
        .describe("File path (relative to project) to focus on — shows only nearby files"),
      zoom: z
        .enum(["file", "directory"])
        .optional()
        .describe("Zoom level: 'file' (default) or 'directory' for large projects"),
      maxNodes: z
        .number()
        .optional()
        .describe("Max nodes in graph (default: 50, auto-switches to directory view if exceeded)"),
    },
    async ({ directory, focus, zoom, maxNodes }) => {
      const { projectDir, db: ragDb } = await resolveProject(directory, getDB);

      const map = generateProjectMap(ragDb, {
        projectDir,
        focus,
        zoom: zoom ?? "file",
        maxNodes: maxNodes ?? 50,
      });

      return {
        content: [{ type: "text" as const, text: map }],
      };
    }
  );

  server.tool(
    "find_usages",
    "Find every usage (call site or reference) of a symbol across the codebase. Returns file paths, line numbers, and the matching line. Excludes the file that defines the symbol. Use this before renaming or changing a function signature to understand the blast radius.",
    {
      symbol: z.string().describe("Symbol name to search for"),
      exact: z
        .boolean()
        .optional()
        .describe("Require exact word-boundary match (default: true). Set false for prefix/substring matching."),
      directory: z
        .string()
        .optional()
        .describe("Project directory. Defaults to RAG_PROJECT_DIR env or cwd"),
      top: z.number().optional().describe("Max results to return (default: 30)"),
    },
    async ({ symbol, exact, directory, top }) => {
      const { projectDir, db: ragDb } = await resolveProject(directory, getDB);

      const results = ragDb.findUsages(symbol, exact ?? true, top ?? 30);

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No usages of "${symbol}" found. The symbol may only appear in its definition file, or the index may need re-running.` }],
        };
      }

      // Group by file
      const byFile = new Map<string, { line: number | null; snippet: string }[]>();
      for (const r of results) {
        if (!byFile.has(r.path)) byFile.set(r.path, []);
        byFile.get(r.path)!.push({ line: r.line, snippet: r.snippet });
      }

      const fileCount = byFile.size;
      const lines: string[] = [
        `Found ${results.length} usage${results.length !== 1 ? "s" : ""} of "${symbol}" across ${fileCount} file${fileCount !== 1 ? "s" : ""}:\n`,
      ];

      for (const [path, usages] of byFile) {
        lines.push(path);
        for (const u of usages) {
          const lineStr = u.line != null ? `:${u.line}` : "";
          lines.push(`  ${lineStr}  ${u.snippet}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "depends_on",
    "List all files that a given file imports (its dependencies). Returns resolved file paths only — unresolved or external imports are excluded.",
    {
      file: z.string().describe("File path (relative to project) to query"),
      directory: z
        .string()
        .optional()
        .describe("Project directory. Defaults to RAG_PROJECT_DIR env or cwd"),
    },
    async ({ file, directory }) => {
      const { projectDir, db: ragDb } = await resolveProject(directory, getDB);

      const absPath = resolve(projectDir, file);
      const fileRecord = ragDb.getFileByPath(absPath);
      if (!fileRecord) {
        return { content: [{ type: "text" as const, text: `File "${file}" not found in index.` }] };
      }

      const deps = ragDb.getDependsOn(fileRecord.id);
      if (deps.length === 0) {
        return { content: [{ type: "text" as const, text: `${file} has no indexed dependencies.` }] };
      }

      const lines = [`${file} depends on ${deps.length} file${deps.length !== 1 ? "s" : ""}:\n`];
      for (const dep of deps) {
        lines.push(`  ${relative(projectDir, dep.path)}  (import: ${dep.source})`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "depended_on_by",
    "List all files that import a given file (its reverse dependencies / importers). Use this to understand the blast radius before modifying a file.",
    {
      file: z.string().describe("File path (relative to project) to query"),
      directory: z
        .string()
        .optional()
        .describe("Project directory. Defaults to RAG_PROJECT_DIR env or cwd"),
    },
    async ({ file, directory }) => {
      const { projectDir, db: ragDb } = await resolveProject(directory, getDB);

      const absPath = resolve(projectDir, file);
      const fileRecord = ragDb.getFileByPath(absPath);
      if (!fileRecord) {
        return { content: [{ type: "text" as const, text: `File "${file}" not found in index.` }] };
      }

      const importers = ragDb.getDependedOnBy(fileRecord.id);
      if (importers.length === 0) {
        return { content: [{ type: "text" as const, text: `No files import ${file}.` }] };
      }

      const lines = [`${file} is imported by ${importers.length} file${importers.length !== 1 ? "s" : ""}:\n`];
      for (const imp of importers) {
        lines.push(`  ${relative(projectDir, imp.path)}  (import: ${imp.source})`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
