import { env, AutoTokenizer, AutoModelForSequenceClassification, type PreTrainedTokenizer, type PreTrainedModel } from "@huggingface/transformers";
import { join } from "node:path";
import { homedir } from "node:os";
import { rmSync } from "node:fs";
import { log } from "../utils/log";

// Share the same cache directory as embeddings
const CACHE_DIR = join(homedir(), ".cache", "local-rag", "models");
env.cacheDir = CACHE_DIR;

const RERANKER_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let loadingPromise: Promise<void> | null = null;

async function loadReranker(): Promise<void> {
  if (tokenizer && model) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const start = performance.now();
    try {
      tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL_ID, {
        cache_dir: CACHE_DIR,
      });
      model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, {
        dtype: "fp32",
        cache_dir: CACHE_DIR,
      });
      const elapsed = Math.round(performance.now() - start);
      log.debug(`Reranker loaded in ${elapsed}ms`, "reranker");
    } catch (err) {
      // If the cached model is corrupted, delete it and retry once
      const msg = (err as Error).message || "";
      if (msg.includes("Protobuf parsing failed") || msg.includes("Load model")) {
        const modelDir = join(CACHE_DIR, ...RERANKER_MODEL_ID.split("/"));
        rmSync(modelDir, { recursive: true, force: true });
        tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL_ID, {
          cache_dir: CACHE_DIR,
        });
        model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, {
          dtype: "fp32",
          cache_dir: CACHE_DIR,
        });
      } else {
        loadingPromise = null;
        throw err;
      }
    }
  })();

  return loadingPromise;
}

/**
 * Score a list of (query, passage) pairs using a cross-encoder reranker.
 * Returns relevance scores (higher = more relevant).
 * Scores are sigmoid-normalized to [0, 1].
 */
export async function rerank(
  query: string,
  passages: string[],
): Promise<number[]> {
  if (passages.length === 0) return [];

  await loadReranker();
  if (!tokenizer || !model) throw new Error("Reranker failed to load");

  const scores: number[] = [];

  // Process one at a time to avoid OOM on large result sets
  for (const passage of passages) {
    const inputs = tokenizer(query, {
      text_pair: passage,
      padding: true,
      truncation: true,
      max_length: 512,
    });

    const output = await model(inputs);
    // Cross-encoder output is a single logit — apply sigmoid
    const logit = output.logits.data[0] as number;
    scores.push(sigmoid(logit));
  }

  return scores;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Reset the singleton — only for testing */
export function resetReranker(): void {
  tokenizer = null;
  model = null;
  loadingPromise = null;
}
