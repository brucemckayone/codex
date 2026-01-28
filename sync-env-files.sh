#!/bin/bash

# =============================================================================
# Environment File Sync - Simple Version
# =============================================================================
#
# Syncs environment/config files from a sibling git worktree to current dir.
# Perfect for keeping .env.*, .dev.vars, wrangler.jsonc in sync across worktrees.
#
# USAGE:
#   ./sync-env-files.sh [sibling-directory]
#
# EXAMPLES:
#   ./sync-env-files.sh fromthisone              # Sync from ../fromthisone
#   ./sync-env-files.sh ../main                  # Sync from ../main
#   ./sync-env-files.sh ../feature-branch        # Sync from any sibling
#
# WHAT GETS COPIED:
#   - Root: .env.example, .env.dev, .env.test, .gitignore, package.json
#   - Workers (8): wrangler.jsonc, .dev.vars*, package.json for each
#   - Infrastructure: docker-compose files
#
# TYPICAL WORKFLOW:
#   1. Create new worktree: git worktree add ../feature-branch feature-name
#   2. Cd to new worktree: cd ../feature-branch
#   3. Copy env files: ../main/sync-env-files.sh main
#   4. Start working with all your config files ready
#
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default sibling directory name
SIBLING_DIR="${1:-fromthisone}"

# Resolve to absolute path
if [[ "$SIBLING_DIR" == ..* ]]; then
    SOURCE_DIR="$(cd "$SIBLING_DIR" && pwd)"
else
    SOURCE_DIR="$(cd "../$SIBLING_DIR" && pwd)"
fi

TARGET_DIR="$(pwd)"

echo -e "${BLUE}=== Environment File Sync ===${NC}"
echo -e "Source: ${GREEN}$SOURCE_DIR${NC}"
echo -e "Target: ${GREEN}$TARGET_DIR${NC}"
echo ""

# Check if source directory exists
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo -e "${RED}Error: Source directory '$SOURCE_DIR' does not exist${NC}"
    echo -e "Usage: $0 [sibling-dir-name]"
    echo -e "Example: $0 fromthisone"
    exit 1
fi

# Counter for copied files
COPIED=0
SKIPPED=0
ERRORS=0

# Function to copy file if it exists in source
copy_file() {
    local rel_path="$1"
    local source_file="$SOURCE_DIR/$rel_path"
    local target_file="$TARGET_DIR/$rel_path"

    if [[ -f "$source_file" ]]; then
        # Create target directory if it doesn't exist
        local target_dir
        target_dir="$(dirname "$target_file")"
        mkdir -p "$target_dir"

        # Copy file
        if cp "$source_file" "$target_file" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} $rel_path"
            ((COPIED++))
        else
            echo -e "${RED}✗${NC} $rel_path (copy failed)"
            ((ERRORS++))
        fi
    else
        echo -e "${YELLOW}○${NC} $rel_path (not in source)"
        ((SKIPPED++))
    fi
}

echo -e "${BLUE}Copying files...${NC}"
echo ""

# Root level environment files
copy_file ".env.example"
copy_file ".env.dev"
copy_file ".env.test"
copy_file ".gitignore"

# Worker configuration files (all 8 workers)
for worker in auth content-api ecom-api identity-api admin-api media-api notifications-api organization-api; do
    copy_file "workers/$worker/wrangler.jsonc"
    copy_file "workers/$worker/.dev.vars.example"
    copy_file "workers/$worker/.dev.vars"
    copy_file "workers/$worker/package.json"
done

# Infrastructure files
copy_file "infrastructure/neon/docker-compose.dev.local.yml"
copy_file "infrastructure/neon/docker-compose.dev.ephemeral.yml"

# Additional config files that might be useful
copy_file ".nvmrc"
copy_file "package.json"
copy_file "turbo.json"
copy_file "tsconfig.json"

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo -e "${GREEN}Copied:${NC}    $COPIED files"
echo -e "${YELLOW}Skipped:${NC}   $SKIPPED files (not in source)"
echo -e "${RED}Errors:${NC}     $ERRORS files"

if [[ $ERRORS -gt 0 ]]; then
    echo ""
    echo -e "${RED}Some files failed to copy. Check permissions and disk space.${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Sync complete!${NC}"
echo -e "${YELLOW}Note: This script copies .dev.vars files which contain secrets.${NC}"
echo -e "${YELLOW}      Make sure you trust the source directory.${NC}"
