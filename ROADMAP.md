# local-rag — Roadmap

Competitive analysis and feature plan, March 2026.

## Competitive landscape

Six tools compete in the Claude Code local RAG space:

| | local-rag | rag-cli | claude-context (Zilliz) | knowledge-rag | mcp-local-rag | claude-context-local |
|---|---|---|---|---|---|---|
| Distribution | MCP server | **Plugin** (marketplace) | MCP server | MCP server | MCP server | MCP server |
| Runtime | Bun | Python | Node.js | Python 3.11-3.12 | Node.js | Python 3.12+ |
| Vector store | SQLite + sqlite-vec | ChromaDB | Milvus (cloud) | ChromaDB + DuckDB | LanceDB | FAISS |
| Embedding | all-MiniLM-L6-v2 (384d, 23MB) | all-MiniLM-L6-v2 (384d) | OpenAI API (paid) | bge-small-en-v1.5 (384d) | all-MiniLM-L6-v2 (384d) | EmbeddingGemma-300m (768d, 1.2GB) |
| Reranking | No | Cross-encoder | No | Cross-encoder | No | No |
| API keys | None | None | **OpenAI + Zilliz** | None | None | None |
| MCP tools | 16 | ~5 | 4 | 12 | 6 | ~3 |
| AST chunking | 6 languages | No | Yes | No | No | 9+ languages |
| File types | 20+ | 5 (docs only) | Unspecified | 9 | 4 | Code only (15 ext) |
| Hybrid search | Vector + BM25 | Vector + keyword | Vector only | Vector + BM25 + reranker | Vector + keyword | Vector only |

### Features only local-rag has

None of the competitors offer any of these:

- Conversation history indexing & search
- Session checkpoints (create, list, search)
- Code annotations (inline in search results)
- `find_usages` (call-site enumeration)
- `project_map` (Mermaid dependency graph)
- `git_context` (uncommitted changes + index status)
- Search analytics with gap analysis
- `write_relevant` (insertion point finder)

### Honest weaknesses

1. **No reranking** — knowledge-rag's cross-encoder produces more precise results for ambiguous queries
2. **Not in the plugin marketplace** — rag-cli has a discovery advantage
3. **Solo maintainer** — same as most, but Zilliz has a company behind claude-context
4. **No office docs** — rag-cli, knowledge-rag, mcp-local-rag handle PDF/DOCX
5. **Bun dependency** — some environments only approve Node.js
6. **384d embeddings** — claude-context-local captures more semantic nuance with 768d

---

## Feature plan

### 1. Claude Code plugin (priority: critical)

**What:** Wrap the existing MCP server in a Claude Code plugin package for marketplace distribution.

**Why this is #1:**
- rag-cli is the only competitor in the marketplace today — first-mover advantage erodes daily
- A plugin bundles skills (replaces CLAUDE.md copy-paste), hooks (auto-reindex, auto-checkpoint), and the MCP server in one install
- `claude /plugin install local-rag` vs manually editing settings.json is a massive friction reduction
- Hooks unlock capabilities no MCP-only server can match

**Plugin structure:**

```
local-rag/
  .claude-plugin/
    plugin.json              # manifest (name, version, description, components)
  .mcp.json                  # existing MCP server config
  skills/
    rag-search.md            # auto-triggers RAG tools (replaces CLAUDE.md instructions)
  hooks/
    hooks.json               # lifecycle event handlers
  src/                       # existing source, unchanged
```

**Hooks to implement:**

| Hook | Trigger | Action |
|---|---|---|
| `PostToolUse` | After Write/Edit tool | Re-index the modified file |
| `SessionEnd` | Session closes | Auto-create checkpoint with summary |
| `SessionStart` | Session opens | Run `git_context` and surface relevant annotations |

**Non-goal:** The core MCP server stays usable standalone via `bunx local-rag serve` for Cursor/Windsurf/VS Code users. The plugin is a wrapper, not a rewrite.

**Estimated scope:** Small-medium. Plugin manifest + skills + hooks + marketplace submission. No changes to core search/indexing.

---

### 2. Cross-encoder reranking (priority: high)

**What:** Add a second-pass reranker on top of existing hybrid search results.

**Why reranking, not a bigger embedding model:**

| Approach | Pros | Cons |
|---|---|---|
| Swap to 768d model (e.g. EmbeddingGemma-300m) | Better base representations | 1.2GB download, 2x storage, slower indexing, breaks existing indexes |
| Add cross-encoder reranker on top of 384d | Precision where it matters (query time), keep fast indexing | ~80MB extra model, slight latency on queries |

The reranker only runs on the top-K results (5-20 items), so the cost is negligible. Indexing speed and disk usage stay the same.

**Model candidates:**
- `ms-marco-MiniLM-L-6-v2` (~80MB) — proven, used by knowledge-rag and rag-cli
- `bge-reranker-base` (~110MB) — newer, potentially better on code

**Implementation:**
1. After hybrid search returns top-K results, run each (query, chunk) pair through the cross-encoder
2. Re-sort by cross-encoder score
3. Make it optional via config (`"reranker": true/false`, default true)
4. First query triggers model download + cache (same pattern as embeddings)

**Estimated scope:** Medium. New module for reranking, integration with search pipeline, config option.

---

### 3. Polish and showcase moat features (priority: high)

**What:** The unique features (conversation search, checkpoints, annotations, find_usages, project_map, git_context, analytics) are the primary competitive advantage. No competitor has any of them. But they need to be more visible and polished.

**Actions:**

- **Demo command:** `local-rag demo` — runs a scripted walkthrough showing search → annotations surfacing inline → find_usages → project_map, against the project's own codebase
- **GIF/video:** Record a 30-second terminal session showing the workflow. Embed in README
- **Improve checkpoint auto-creation:** When running as a plugin, hooks create checkpoints at natural boundaries (session end, major file changes). Users shouldn't have to remember to create them
- **Analytics summary on startup:** When `SessionStart` fires, if analytics show documentation gaps, surface them proactively ("3 recent searches found nothing — consider documenting: X, Y, Z")

**Why this matters:** Features that users don't know about have zero competitive value. The README lists them but doesn't show them in action.

**Estimated scope:** Small per item, but cumulative. Spread across multiple releases.

---

### 4. Office document support (priority: low)

**What:** Add PDF, DOCX, XLSX, PPTX ingestion.

**Why it's last:**
- Core users are developers searching code and technical docs — they don't store knowledge in Word files
- Competitors that support office docs (rag-cli, knowledge-rag) are document-search tools that added some code support. We're a code-search tool. Different positioning
- Adding PDF parsing pulls in large dependencies (pdf-parse, mammoth, etc.) and increases attack surface

**When it makes sense:**
- If the plugin marketplace shows demand (search analytics from users searching for "PDF" or "document")
- If targeting non-dev users (PMs, tech writers) who store runbooks in Google Docs exports

**Implementation sketch:**
- PDF: `pdf-parse` or `pdfjs-dist` → extract text → paragraph chunking
- DOCX: `mammoth` → extract text → paragraph chunking
- Keep these behind a config flag (`"officeFormats": true`) so the base install stays lean

**Estimated scope:** Medium. New parsers, chunking strategies, tests. Risk of edge cases with complex layouts.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-21 | Plugin before all other features | Marketplace discovery is the #1 growth lever; hooks enable auto-reindex and auto-checkpoint |
| 2026-03-21 | Reranker over bigger embeddings | Precision win without disk/speed penalty; keeps zero-friction install |
| 2026-03-21 | Node.js compat cut | Bun adoption is growing; no concrete user demand; maintaining two runtimes is expensive; Bun's built-in SQLite is a core dependency |
| 2026-03-21 | Office docs last | Core audience is developers; broadening file support dilutes positioning |
