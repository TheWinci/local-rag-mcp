import { embed } from "../embeddings/embed";
import { RagDB, type SearchResult, type ChunkSearchResult } from "../db";
import { log } from "../utils/log";

export interface DedupedResult {
  path: string;
  score: number;
  snippets: string[];
}

export interface ChunkResult {
  path: string;
  score: number;
  content: string;
  chunkIndex: number;
  entityName: string | null;
  chunkType: string | null;
  startLine: number | null;
  endLine: number | null;
}

// Default: 70% vector, 30% BM25
const DEFAULT_HYBRID_WEIGHT = 0.7;

/**
 * Merge vector and text search results using hybrid scoring.
 * Each result must have `score`, `path`, and `chunkIndex` at minimum.
 * Extra fields from the vector results are preserved on the merged output.
 */
export function mergeHybridScores<T extends { score: number; path: string; chunkIndex: number }>(
  vectorResults: T[],
  textResults: T[],
  hybridWeight: number
): T[] {
  const scoreMap = new Map<string, { item: T; vectorScore: number; textScore: number }>();

  for (const r of vectorResults) {
    const key = `${r.path}:${r.chunkIndex}`;
    scoreMap.set(key, { item: r, vectorScore: r.score, textScore: 0 });
  }

  for (const r of textResults) {
    const key = `${r.path}:${r.chunkIndex}`;
    const existing = scoreMap.get(key);
    if (existing) {
      existing.textScore = r.score;
    } else {
      scoreMap.set(key, { item: r, vectorScore: 0, textScore: r.score });
    }
  }

  return Array.from(scoreMap.values()).map((entry) => ({
    ...entry.item,
    score: hybridWeight * entry.vectorScore + (1 - hybridWeight) * entry.textScore,
  }));
}

export async function search(
  query: string,
  db: RagDB,
  topK: number = 5,
  threshold: number = 0,
  hybridWeight: number = DEFAULT_HYBRID_WEIGHT
): Promise<DedupedResult[]> {
  const start = performance.now();
  const queryEmbedding = await embed(query);

  // Fetch more than topK to allow deduplication
  const vectorResults = db.search(queryEmbedding, topK * 3);

  // BM25 text search for keyword matching
  let textResults: typeof vectorResults = [];
  try {
    textResults = db.textSearch(query, topK * 3);
  } catch (err) {
    log.debug(`FTS query failed, falling back to vector-only: ${err instanceof Error ? err.message : err}`, "search");
  }

  const merged = mergeHybridScores(vectorResults, textResults, hybridWeight);

  // Deduplicate by file path, keeping the best score per file
  const byFile = new Map<string, DedupedResult>();

  for (const result of merged) {
    if (threshold > 0 && result.score < threshold) continue;

    const existing = byFile.get(result.path);
    if (existing) {
      if (result.score > existing.score) {
        existing.score = result.score;
      }
      if (!existing.snippets.includes(result.snippet)) {
        existing.snippets.push(result.snippet);
      }
    } else {
      byFile.set(result.path, {
        path: result.path,
        score: result.score,
        snippets: [result.snippet],
      });
    }
  }

  // Sort by score descending, take topK files
  const results = Array.from(byFile.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Log query for analytics
  const durationMs = Math.round(performance.now() - start);
  db.logQuery(
    query,
    results.length,
    results[0]?.score ?? null,
    results[0]?.path ?? null,
    durationMs
  );

  return results;
}

/**
 * Chunk-level search: returns individual semantic chunks ranked by relevance.
 * No file deduplication — two chunks from the same file can both appear.
 */
export async function searchChunks(
  query: string,
  db: RagDB,
  topK: number = 8,
  threshold: number = 0.3,
  hybridWeight: number = DEFAULT_HYBRID_WEIGHT
): Promise<ChunkResult[]> {
  const start = performance.now();
  const queryEmbedding = await embed(query);

  const vectorResults = db.searchChunks(queryEmbedding, topK * 3);

  let textResults: ChunkSearchResult[] = [];
  try {
    textResults = db.textSearchChunks(query, topK * 3);
  } catch (err) {
    log.debug(`FTS chunk query failed, falling back to vector-only: ${err instanceof Error ? err.message : err}`, "search");
  }

  const results = mergeHybridScores(vectorResults, textResults, hybridWeight)
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Log query for analytics
  const durationMs = Math.round(performance.now() - start);
  db.logQuery(
    query,
    results.length,
    results[0]?.score ?? null,
    results[0]?.path ?? null,
    durationMs
  );

  return results;
}
