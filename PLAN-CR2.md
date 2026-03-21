# Code Review Round 2 — Remediation Plan

## Correctness

1. **`index_files` mutates shared config object** — Spread a copy before overriding `include`.
   - File: `src/tools/index-tools.ts:30-32`

2. **`assignLineNumbers` off-by-one on `endLine`** — Use `idx + chunk.text.length - 1` so endLine points to the line containing the last character, not the line after.
   - File: `src/indexing/chunker.ts:198`

3. **`insertTurn` returns 0 on duplicate, caller inflates counts** — Check return value in `indexTurn` and return false when duplicate.
   - Files: `src/db/conversation.ts:69`, `src/conversation/indexer.ts:71-84`

## Robustness

4. **`readJSONL` allocates full remaining file** — Defer (document risk). Incremental reads keep this bounded in practice since `fromOffset` advances. Add a size warning log for >50MB reads.
   - File: `src/conversation/parser.ts:80-81`

5. **`resolveImportsForFile` re-fetches all paths every call** — Accept optional prebuilt `pathToId` map; build once in watcher callback and pass to all calls.
   - Files: `src/graph/resolver.ts:47-52`, `src/indexing/watcher.ts:58-65`

6. **`searchChunks` swallows FTS errors silently** — Add debug log matching `search()`.
   - File: `src/search/hybrid.ts:141`

## Code Quality

7. **Duplicated projectDir/getDB/loadConfig boilerplate** — Extract `resolveProject(directory, getDB)` helper.
   - Files: all `src/tools/*.ts`

8. **`loadConfig` array merge behavior** — Document in config comment that user `include` replaces defaults.
   - File: `src/config/index.ts`

9. **Conversation hybrid search re-implemented in tool layer** — Refactor to use `mergeHybridScores` from hybrid.ts (export it).
   - Files: `src/search/hybrid.ts`, `src/tools/conversation-tools.ts`

10. **No FTS content-sync trigger for UPDATE** — Add UPDATE trigger on chunks table.
    - File: `src/db/index.ts`

11. **`splitCSS` brace counting ignores strings/comments** — Defer (edge case, low risk).

12. **`discoverSessions` path encoding fragility** — Defer (matches Claude Code behavior today).

## Testing

13. **FTS special chars test: no positive-match assertion** — Add assertion that "node.js" query returns the indexed file.
    - File: `tests/search/fts-special-chars.test.ts`

14. **No test for `insertTurn` duplicate detection** — Add test calling insertTurn twice with same key, verify no duplicate chunks.
    - File: new test or extend existing conversation test

## Implementation Order

1. #1 config mutation (trivial)
2. #6 searchChunks error logging (trivial)
3. #2 endLine off-by-one (small)
4. #3 insertTurn duplicate return (small)
5. #10 FTS UPDATE trigger (small)
6. #5 resolveImportsForFile caching (medium)
7. #9 conversation hybrid dedup (medium)
8. #7 tool boilerplate extraction (medium)
9. #8 config docs (trivial)
10. #13 positive-match test (small)
11. #14 duplicate detection test (small)

Deferred: #4 (readJSONL memory — bounded in practice), #11 (CSS edge case), #12 (path encoding)
