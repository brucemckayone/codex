#!/usr/bin/env bash
# Skill self-lint — runs checks across SKILL.md + references/ to catch drift
# between reviews and skill edits.
#
# Usage: bash .claude/skills/backend-dev/lint-skill.sh
# Exit 0 if clean, 1 if issues found.

set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REF_DIR="$SKILL_DIR/references"
REPO_ROOT="/Users/brucemckay/development/Codex"
FAIL=0

echo "== Skill lint: $SKILL_DIR =="

# 1. SKILL.md reference links resolve
echo ""
echo "-- Check 1: SKILL.md reference links resolve"
c1_fail=0
while IFS= read -r link; do
  if [ ! -f "$SKILL_DIR/$link" ]; then
    echo "  BROKEN: SKILL.md references $link but file doesn't exist"
    c1_fail=1; FAIL=1
  fi
done < <(grep -oE 'references/[0-9][0-9]-[a-z-]+\.md' "$SKILL_DIR/SKILL.md" | sort -u)
[ "$c1_fail" -eq 0 ] && echo "  OK — all reference links resolve"

# 2. Frontmatter
echo ""
echo "-- Check 2: Each reference has YAML frontmatter"
c2_fail=0
for ref in "$REF_DIR"/*.md; do
  if ! head -1 "$ref" | grep -qE '^---$'; then
    echo "  MISSING frontmatter: $(basename "$ref")"
    c2_fail=1; FAIL=1
  fi
done
[ "$c2_fail" -eq 0 ] && echo "  OK — all references have frontmatter"

# 3. Duplicate anti-pattern rows (same left-column text in anti-patterns section)
# Only look INSIDE "## Anti-Patterns" or "## ... Anti-Patterns" sections.
echo ""
echo "-- Check 3: Duplicate anti-pattern rows (scoped to anti-pattern sections)"
c3_fail=0
for ref in "$REF_DIR"/*.md; do
  # Extract rows from anti-pattern sections only
  rows=$(awk '
    /^## .*[Aa]nti-[Pp]attern/ { in_section=1; next }
    /^## / { in_section=0 }
    in_section && /^\| / && !/^\|---/ && !/^\| Anti-pattern/ { print }
  ' "$ref" | awk -F'|' '{print $2}' | sort)
  dups=$(echo "$rows" | uniq -d)
  if [ -n "$dups" ] && [ -n "$(echo "$dups" | tr -d ' ')" ]; then
    echo "  DUPLICATES in $(basename "$ref") anti-pattern section:"
    echo "$dups" | sed 's/^/    /'
    c3_fail=1; FAIL=1
  fi
done
[ "$c3_fail" -eq 0 ] && echo "  OK — no duplicate anti-pattern rows"

# 4. "When to Re-Verify" footer present on each reference
echo ""
echo "-- Check 4: Each reference has 'When to Re-Verify' footer"
c4_fail=0
for ref in "$REF_DIR"/*.md; do
  if ! grep -qE '^## When to Re-Verify' "$ref"; then
    echo "  MISSING: $(basename "$ref") has no 'When to Re-Verify' footer"
    c4_fail=1; FAIL=1
  fi
done
[ "$c4_fail" -eq 0 ] && echo "  OK — all references have re-verify footer"

# 5. TODO markers in content (not in this script itself)
echo ""
echo "-- Check 5: No TODO/FIXME/XXX markers in skill content"
todo_count=$(grep -rE 'TODO|FIXME|XXX' "$SKILL_DIR" --include='*.md' 2>/dev/null | wc -l | tr -d ' ')
if [ "$todo_count" -gt 0 ]; then
  echo "  WARNING: $todo_count TODO/FIXME markers found (non-fatal):"
  grep -rE 'TODO|FIXME|XXX' "$SKILL_DIR" --include='*.md' 2>/dev/null | head -5
else
  echo "  OK — no TODO markers in .md files"
fi

# 6. Cited source files exist
echo ""
echo "-- Check 6: Cited source files exist (line numbers not verified)"
c6_fail=0
MISSING=0
while IFS= read -r file; do
  clean_path=$(echo "$file" | sed 's/[.,;:)]*$//')
  if [ ! -e "$REPO_ROOT/$clean_path" ]; then
    echo "  MISSING: $clean_path"
    MISSING=$((MISSING + 1))
  fi
done < <(grep -ohE '(packages|workers|apps)/[a-zA-Z0-9_./-]+\.ts' "$REF_DIR"/*.md "$SKILL_DIR/SKILL.md" 2>/dev/null | sort -u)
if [ "$MISSING" -gt 0 ]; then
  echo "  $MISSING cited files missing — update paths in refs"
  c6_fail=1; FAIL=1
else
  echo "  OK — all cited file paths resolve"
fi

# 7. File length sanity
echo ""
echo "-- Check 7: Reference file length sanity (warn <50 or >1500 lines)"
for ref in "$REF_DIR"/*.md "$SKILL_DIR/SKILL.md"; do
  lines=$(wc -l < "$ref" | tr -d ' ')
  if [ "$lines" -lt 50 ] || [ "$lines" -gt 1500 ]; then
    echo "  SIZE WARN: $(basename "$ref") = $lines lines"
  fi
done
echo "  done"

echo ""
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  echo "PASS — skill lint clean"
  exit 0
else
  echo "FAIL — see warnings above"
  exit 1
fi
