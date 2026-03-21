#!/bin/bash
# SessionStart hook: ensure the index is warm on session start.
# The MCP server handles auto-indexing, so this is a lightweight check
# that logs index status for visibility.

STATUS=$(bunx local-rag status 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "$STATUS" >&2
fi

exit 0
