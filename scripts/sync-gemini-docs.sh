#!/bin/bash
# Sync CLAUDE.md files to GEMINI.md for Gemini CLI context

find . -name "CLAUDE.md" | while read -r claude_file; do
    gemini_file="${claude_file/CLAUDE.md/GEMINI.md}"
    echo "Syncing $claude_file to $gemini_file"
    cp "$claude_file" "$gemini_file"
done
