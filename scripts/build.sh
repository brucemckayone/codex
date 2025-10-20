#!/bin/bash
# Build script for D2 diagrams
# Automatically compiles all .d2 files to PNG assets

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../assets"
THEME="200"  # Dark Mauve theme ID
LAYOUT="elk" # ELK layout engine

# Create assets directory if it doesn't exist
mkdir -p "$ASSETS_DIR"

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  D2 Diagram Build Script${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""

# Check if d2 is installed
if ! command -v d2 &> /dev/null; then
    echo -e "${RED}Error: d2 is not installed${NC}"
    echo "Install it with: brew install d2"
    exit 1
fi

echo -e "${GREEN}✓ d2 found: $(d2 version)${NC}"
echo ""

# Function to compile a single D2 file
compile_d2() {
    local input_file="$1"
    local filename=$(basename "$input_file" .d2)

    # Skip theme.d2 and other utility files
    if [[ "$filename" == "theme" ]] || [[ "$filename" == "_"* ]]; then
        echo -e "${YELLOW}⊘ Skipping: $filename.d2 (utility file)${NC}"
        return
    fi

    local output_file="${ASSETS_DIR}/${filename}.png"

    echo -e "${BLUE}▸ Compiling: $filename.d2${NC}"

    # Compile with d2
    if d2 --theme="$THEME" --layout="$LAYOUT" "$input_file" "$output_file" 2>&1 | grep -q "success:"; then
        local size=$(du -h "$output_file" | cut -f1)
        echo -e "${GREEN}  ✓ Created: ${filename}.png (${size})${NC}"
    else
        echo -e "${RED}  ✗ Failed to compile: $filename.d2${NC}"
        return 1
    fi

    echo ""
}

# Find and compile all .d2 files
echo -e "${BLUE}Searching for .d2 files...${NC}"
echo ""

compiled=0
failed=0

while IFS= read -r -d '' file; do
    if compile_d2 "$file"; then
        ((compiled++))
    else
        ((failed++))
    fi
done < <(find "$SCRIPT_DIR" -maxdepth 1 -name "*.d2" -type f -print0)

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Compiled: $compiled diagram(s)${NC}"
if [ $failed -gt 0 ]; then
    echo -e "${RED}✗ Failed: $failed diagram(s)${NC}"
fi
echo -e "${BLUE}════════════════════════════════════════${NC}"

exit $failed
