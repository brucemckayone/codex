#!/bin/bash

# =============================================================================
# Environment File Sync - Advanced Version
# =============================================================================
#
# Full-featured sync between parallel git worktrees with bidirectional support.
# Use this version when you need dry-run, reverse sync, or verbose output.
#
# USAGE:
#   ./sync-env-files-advanced.sh [options] [sibling-directory]
#
# OPTIONS:
#   -n, --dry-run         Preview changes without copying files
#   -b, --bidirectional   Sync both directions (source→target AND target→source)
#   -s, --source-only     Copy only from source to target (DEFAULT)
#   -t, --target-only     Copy only from target to source (REVERSE sync)
#   -v, --verbose         Show detailed output for every file
#   -f, --force           Overwrite existing files without prompting
#   -h, --help            Show this help message
#
# EXAMPLES:
#   ./sync-env-files-advanced.sh fromthisone                    # Basic sync
#   ./sync-env-files-advanced.sh --dry-run fromthisone          # Preview first
#   ./sync-env-files-advanced.sh -n -v fromthisone             # Verbose preview
#   ./sync-env-files-advanced.sh --bidirectional ../main        # Sync both ways
#   ./sync-env-files-advanced.sh --target-only fromthisone      # Reverse sync
#   ./sync-env-files-advanced.sh -v -f fromthisone              # Force overwrite
#
# COMMON WORKFLOWS:
#   1. NEW WORKTREE SETUP:
#      ./sync-env-files-advanced.sh ../main
#
#   2. PREVIEW CHANGES BEFORE SYNCING:
#      ./sync-env-files-advanced.sh --dry-run --verbose fromthisone
#
#   3. SHARE CHANGES BACK TO MAIN WORKTREE:
#      ./sync-env-files-advanced.sh --target-only ../main
#
#   4. BIDIRECTIONAL SYNC (BOTH WAYS):
#      ./sync-env-files-advanced.sh --bidirectional fromthisone
#
#   5. SAFE MERGE (PROMPTS ON DIFFERENT FILES):
#      ./sync-env-files-advanced.sh fromthisone
#
# WHAT GETS COPIED:
#   Same as simple version: .env.*, .dev.vars, wrangler.jsonc, etc.
#
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default options
DRY_RUN=false
BIDIRECTIONAL=false
DIRECTION="source"  # "source" or "target"
VERBOSE=false
FORCE=false
SIBLING_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -b|--bidirectional)
            BIDIRECTIONAL=true
            shift
            ;;
        -s|--source-only)
            DIRECTION="source"
            shift
            ;;
        -t|--target-only)
            DIRECTION="target"
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            cat << EOF
Environment File Sync - Advanced Usage

Usage: $0 [options] [sibling-dir]

Options:
  -n, --dry-run         Show what would be copied without copying
  -b, --bidirectional   Sync both directions (source→target and target→source)
  -s, --source-only     Copy only from source to target (default)
  -t, --target-only     Copy only from target to source
  -v, --verbose         Show detailed file-by-file output
  -f, --force           Overwrite existing files without prompting
  -h, --help            Show this help message

Examples:
  $0 fromthisone                    # Copy from ../fromthisone to current dir
  $0 --dry-run fromthisone          # Preview changes without copying
  $0 --bidirectional ../main        # Sync both ways with ../main
  $0 -v -f fromthisone              # Verbose, force overwrite

Files synced:
  - Root: .env.*, .gitignore, package.json, turbo.json
  - Workers: wrangler.jsonc, .dev.vars*, package.json (all 8 workers)
  - Infrastructure: docker-compose files

EOF
            exit 0
            ;;
        -*)
            echo -e "${RED}Error: Unknown option $1${NC}"
            echo "Use -h or --help for usage"
            exit 1
            ;;
        *)
            SIBLING_DIR="$1"
            shift
            ;;
    esac
done

# Default sibling directory if not specified
if [[ -z "$SIBLING_DIR" ]]; then
    SIBLING_DIR="fromthisone"
fi

# Resolve to absolute paths
if [[ "$SIBLING_DIR" == ..* ]]; then
    SOURCE_DIR="$(cd "$SIBLING_DIR" && pwd)"
else
    SOURCE_DIR="$(cd "../$SIBLING_DIR" && pwd)"
fi
TARGET_DIR="$(pwd)"

# Check if source directory exists
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo -e "${RED}Error: Source directory '$SOURCE_DIR' does not exist${NC}"
    exit 1
fi

# Counters
COPIED=0
SKIPPED=0
ERRORS=0
TOTAL=0

# Array of files to sync
FILES_TO_SYNC=(
    ".env.example"
    ".env.dev"
    ".env.test"
    ".gitignore"
    "workers/auth/wrangler.jsonc"
    "workers/auth/.dev.vars.example"
    "workers/auth/.dev.vars"
    "workers/content-api/wrangler.jsonc"
    "workers/content-api/.dev.vars.example"
    "workers/content-api/.dev.vars"
    "workers/ecom-api/wrangler.jsonc"
    "workers/ecom-api/.dev.vars.example"
    "workers/ecom-api/.dev.vars"
    "workers/identity-api/wrangler.jsonc"
    "workers/identity-api/.dev.vars.example"
    "workers/identity-api/.dev.vars"
    "workers/admin-api/wrangler.jsonc"
    "workers/admin-api/.dev.vars.example"
    "workers/admin-api/.dev.vars"
    "workers/media-api/wrangler.jsonc"
    "workers/media-api/.dev.vars.example"
    "workers/media-api/.dev.vars"
    "workers/notifications-api/wrangler.jsonc"
    "workers/notifications-api/.dev.vars.example"
    "workers/notifications-api/.dev.vars"
    "workers/organization-api/wrangler.jsonc"
    "workers/organization-api/.dev.vars.example"
    "workers/organization-api/.dev.vars"
    "infrastructure/neon/docker-compose.dev.local.yml"
    "infrastructure/neon/docker-compose.dev.ephemeral.yml"
    ".nvmrc"
    "package.json"
    "turbo.json"
    "tsconfig.json"
)

# Function to copy a single file
copy_file() {
    local source="$1"
    local target="$2"
    local rel_path="$3"
    local direction="$4"  # "→" or "←"

    ((TOTAL++))

    if [[ ! -f "$source" ]]; then
        if [[ "$VERBOSE" == "true" ]]; then
            echo -e "${YELLOW}○${NC} $rel_path ${CYAN}(source doesn't exist)${NC}"
        fi
        ((SKIPPED++))
        return
    fi

    # Create target directory if needed
    local target_dir
    target_dir="$(dirname "$target")"
    mkdir -p "$target_dir"

    # Check if target exists and is identical
    if [[ -f "$target" ]]; then
        if cmp -s "$source" "$target"; then
            if [[ "$VERBOSE" == "true" ]]; then
                echo -e "${BLUE}=${NC} $rel_path ${CYAN}(identical, skipped)${NC}"
            fi
            ((SKIPPED++))
            return
        fi

        # Different files - check force flag
        if [[ "$FORCE" != "true" && "$DRY_RUN" != "true" ]]; then
            echo -e "${YELLOW}?${NC} $rel_path ${CYAN}(differs, overwrite? y/n)${NC}"
            read -r response
            if [[ "$response" != "y" && "$response" != "Y" ]]; then
                echo -e "${YELLOW}○${NC} $rel_path ${CYAN}(skipped)${NC}"
                ((SKIPPED++))
                return
            fi
        fi
    fi

    # Perform copy (or dry-run)
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${CYAN}→${NC} $rel_path ${CYAN}(would copy)${NC}"
    else
        if cp "$source" "$target" 2>/dev/null; then
            local arrow=$([[ "$direction" == "source" ]] && echo "→" || echo "←")
            echo -e "${GREEN}✓${NC} $rel_path ${CYAN}$arrow${NC}"
            ((COPIED++))
        else
            echo -e "${RED}✗${NC} $rel_path ${CYAN}(copy failed)${NC}"
            ((ERRORS++))
        fi
    fi
}

# Print header
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Environment File Sync${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "Source: ${GREEN}$SOURCE_DIR${NC}"
echo -e "Target: ${GREEN}$TARGET_DIR${NC}"
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}⚠ DRY RUN MODE - No files will be copied${NC}"
    echo ""
fi

if [[ "$BIDIRECTIONAL" == "true" ]]; then
    echo -e "${CYAN}Mode: Bidirectional sync${NC}"
elif [[ "$DIRECTION" == "target" ]]; then
    echo -e "${CYAN}Mode: Target → Source (reverse sync)${NC}"
else
    echo -e "${CYAN}Mode: Source → Target (forward sync)${NC}"
fi

echo ""
echo -e "${BLUE}Syncing files...${NC}"
echo ""

# Perform sync based on direction
if [[ "$BIDIRECTIONAL" == "true" || "$DIRECTION" == "source" ]]; then
    echo -e "${CYAN}Source → Target:${NC}"
    for file in "${FILES_TO_SYNC[@]}"; do
        copy_file "$SOURCE_DIR/$file" "$TARGET_DIR/$file" "$file" "source"
    done
    echo ""
fi

if [[ "$BIDIRECTIONAL" == "true" ]]; then
    echo -e "${BLUE}──────────────────────────────────────────────${NC}"
    echo ""
fi

if [[ "$BIDIRECTIONAL" == "true" || "$DIRECTION" == "target" ]]; then
    if [[ "$BIDIRECTIONAL" == "true" ]]; then
        echo -e "${CYAN}Target → Source:${NC}"
    else
        echo -e "${CYAN}Target → Source (reverse sync):${NC}"
    fi
    for file in "${FILES_TO_SYNC[@]}"; do
        copy_file "$TARGET_DIR/$file" "$SOURCE_DIR/$file" "$file" "target"
    done
    echo ""
fi

# Print summary
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Copied:${NC}     $COPIED files"
echo -e "${YELLOW}Skipped:${NC}    $SKIPPED files"
echo -e "${BLUE}Total:${NC}      $TOTAL files"
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}Errors:${NC}      $ERRORS files"
fi

if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}⚠ This was a dry run. Remove --dry-run to actually copy files.${NC}"
fi

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo -e "${RED}Some files failed to copy. Check permissions and disk space.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Sync complete!${NC}"
echo -e "${YELLOW}⚠ Warning: .dev.vars files contain secrets. Verify your sources.${NC}"
