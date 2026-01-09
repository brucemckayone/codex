#!/bin/bash

# Output file
OUT="review_context.md"

echo "# Code Review Context" > "$OUT"
echo "Date: $(date)" >> "$OUT"
echo "Branch: $(git branch --show-current)" >> "$OUT"

echo -e "\n## 1. Project Structure (High Level)" >> "$OUT"
# List apps and packages to give the agent a map of the monorepo
ls -F apps/ packages/ workers/ 2>/dev/null >> "$OUT"

echo -e "\n## 2. Change Statistics" >> "$OUT"
# detailed stats help the agent prioritize where the "meat" of the work is
git diff --stat main...HEAD >> "$OUT"
git diff --stat >> "$OUT"

echo -e "\n## 3. List of Changed Files" >> "$OUT"
# Clean list for the agent to loop over
{ git diff --name-only main...HEAD; git diff --name-only; git ls-files --others --exclude-standard; } | sort | uniq | grep -v "$OUT" >> "$OUT"

echo -e "\n## 4. The Diff (Code Changes)" >> "$OUT"
# We include the diff, but NOT the full files yet. The agent will read full files as needed.
git diff main...HEAD >> "$OUT"
git diff >> "$OUT"

echo "Context prepared in $OUT"
