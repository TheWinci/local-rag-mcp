import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { z } from "zod";
import { log } from "../utils/log";

const RagConfigSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  chunkSize: z.number().int().min(64).default(512),
  chunkOverlap: z.number().int().min(0).default(50),
  hybridWeight: z.number().min(0).max(1).default(0.7),
  searchTopK: z.number().int().min(1).default(5),
  indexBatchSize: z.number().int().min(1).optional(),
  indexThreads: z.number().int().min(1).optional(),
  enableReranking: z.boolean().default(true),
  benchmarkTopK: z.number().int().min(1).default(5),
  benchmarkMinRecall: z.number().min(0).max(1).default(0.8),
  benchmarkMinMrr: z.number().min(0).max(1).default(0.6),
});

export type RagConfig = z.infer<typeof RagConfigSchema>;

const DEFAULT_CONFIG: RagConfig = {
  include: [
    // Markdown & plain text
    "**/*.md", "**/*.txt",
    // Build / task runners (no extension or prefix-named)
    "**/Makefile", "**/makefile", "**/GNUmakefile",
    "**/Dockerfile", "**/Dockerfile.*",
    "**/Jenkinsfile", "**/Jenkinsfile.*",
    "**/Vagrantfile", "**/Gemfile", "**/Rakefile",
    "**/Brewfile", "**/Procfile",
    // Structured data & config
    "**/*.yaml", "**/*.yml",
    "**/*.json",
    "**/*.toml",
    "**/*.xml",
    // Shell & scripting
    "**/*.sh", "**/*.bash", "**/*.zsh",
    // Infrastructure / schema languages
    "**/*.tf",
    "**/*.proto",
    "**/*.graphql", "**/*.gql",
    "**/*.sql",
    "**/*.mod",
    "**/*.bru",
    "**/*.css", "**/*.scss", "**/*.less",
  ],
  exclude: ["node_modules/**", ".git/**", "dist/**", ".rag/**"],
  chunkSize: 512,
  chunkOverlap: 50,
  hybridWeight: 0.7,
  searchTopK: 5,
  enableReranking: true,
  indexBatchSize: 50,
  benchmarkTopK: 5,
  benchmarkMinRecall: 0.8,
  benchmarkMinMrr: 0.6,
};

/**
 * Load config from .rag/config.json, merged with defaults.
 * Note: array fields (include, exclude) from user config *replace* the defaults
 * entirely — they are not merged. This lets users fully control which files are indexed.
 */
export async function loadConfig(projectDir: string): Promise<RagConfig> {
  const configPath = join(projectDir, ".rag", "config.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  const raw = await readFile(configPath, "utf-8");
  let userConfig: unknown;
  try {
    userConfig = JSON.parse(raw);
  } catch {
    log.warn(`Invalid JSON in ${configPath}, using defaults`, "config");
    return { ...DEFAULT_CONFIG };
  }

  const merged = { ...DEFAULT_CONFIG, ...(userConfig as Record<string, unknown>) };
  const result = RagConfigSchema.safeParse(merged);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    log.warn(`Config validation: ${issues}. Using defaults for invalid fields.`, "config");
    return { ...DEFAULT_CONFIG };
  }

  return result.data;
}

export async function writeDefaultConfig(projectDir: string): Promise<string> {
  const ragDir = join(projectDir, ".rag");
  await mkdir(ragDir, { recursive: true });
  const configPath = join(ragDir, "config.json");
  await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  return configPath;
}
