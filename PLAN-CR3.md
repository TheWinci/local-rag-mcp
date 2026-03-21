# Code Review Round 3 — Remediation Plan

## Critical

### CR3-1: Annotations never surface in `read_relevant`
**File**: `src/tools/search.ts:102`, `src/tools/annotation-tools.ts:32`
**Issue**: `annotate` stores the user-supplied `path` (relative), but `read_relevant` calls `getAnnotations(r.path)` where `r.path` is an absolute path from search results. The paths never match.
**Fix**: Normalize both sides. In `read_relevant`, query annotations with the relative path derived from the project directory. Also normalize in `annotate` to ensure consistent storage.

### CR3-2: `resolveImportsForFile` O(n) reverse lookup
**File**: `src/graph/resolver.ts:54-56`
**Issue**: `[...pathToId.entries()].find(([, id]) => id === fileId)` is O(n) linear scan.
**Fix**: Build an `idToPath` reverse map alongside `pathToId`, or accept `filePath` as a parameter since the caller often knows it.

### CR3-3: `getSubgraph` BFS can exceed SQLite 999 parameter limit
**File**: `src/db/graph.ts:112-119`
**Issue**: The BFS query uses `frontier` twice in placeholders (`IN (${placeholders}) OR ... IN (${placeholders})`), so the actual parameter count is `2 × frontier.length`. Large graphs can exceed SQLite's 999-parameter limit.
**Fix**: Batch the frontier into chunks of ≤499 and union the results.

## Moderate

### CR3-4: No `PRAGMA busy_timeout`
**File**: `src/db/index.ts:84`
**Issue**: Without `busy_timeout`, concurrent readers/writers get immediate SQLITE_BUSY errors.
**Fix**: Add `PRAGMA busy_timeout = 5000;` after WAL mode.

### CR3-5: Dead `symbol_usages` table
**File**: `src/db/index.ts:241-249`
**Issue**: The `symbol_usages` table and its indexes are created but never populated. `findUsages` uses FTS on chunks instead.
**Fix**: Remove the CREATE TABLE and CREATE INDEX statements.

### CR3-6: Unhandled promise rejection on startup indexing
**File**: `src/server/index.ts:58-69`
**Issue**: `indexDirectory(...).then(...)` has no `.catch()`. If indexing throws, the promise rejection is unhandled.
**Fix**: Add `.catch()` with error logging.

## Performance

### CR3-7: Conversation `indexTurn` embeds chunks one-at-a-time
**File**: `src/conversation/indexer.ts:64-67`
**Issue**: Each chunk is embedded individually via `await embed(chunk.text)` in a loop. Should use `embedBatch`.
**Fix**: Collect all chunk texts and call `embedBatch` once.

### CR3-9: Redundant checkpoint embedding storage
**File**: `src/db/checkpoints.ts:22-43`, `src/db/index.ts:219`
**Issue**: Embedding is stored in both `conversation_checkpoints.embedding` BLOB column AND `vec_checkpoints`. The BLOB column is never read by any query.
**Fix**: Stop writing to the BLOB column. Keep the column for backward compatibility but pass `null`.

## Robustness

### CR3-10: Bare FTS catch in conversation-tools
**File**: `src/tools/conversation-tools.ts:36-38`
**Issue**: `catch {}` silently swallows FTS errors with no logging.
**Fix**: Add `log.debug` for the error.

### CR3-11: N+1 annotation queries in `read_relevant`
**File**: `src/tools/search.ts:102`
**Issue**: `getAnnotations(r.path)` is called per result, causing N+1 queries.
**Fix**: Collect unique paths, batch-fetch annotations, then look up from a local map.

## Cleanup

### CR3-12: Unused `existsSync` import
**File**: `src/graph/resolver.ts:2`
**Issue**: `existsSync` is imported but never used.
**Fix**: Remove the import.

---

## Deferred
- CR3-8: Double file read in processFile (fileHash + parseFile) — would require refactoring parseFile signature; low ROI since OS caches the read.
- CR3-13–15: Edge cases from prior review — deferred as low priority.
