#!/bin/bash
set -euo pipefail

# RunPod transcoder image tag, from the image's own inputs.
#
#   .github/scripts/runpod-image-tag.sh   # prints e.g. src-3f2a9c1e7b4d
#
# runpod-ci.yml publishes the image under this tag; deploy-production.yml
# computes it again from its own checkout and points the endpoint at it. Both
# sides need only the checked-out tree (no history), and the tag changes only
# when something that goes INTO the image changes, so a deploy that did not
# touch the transcoder finds the endpoint already current and does nothing.
#
# The inputs are everything tracked under infrastructure/runpod EXCEPT the
# files excluded below, so a file added later is an input until someone
# excludes it. That is the safe direction: runpod-ci writes each tag once, so
# a forgotten input would never ship, while a forgotten exclusion only costs
# one extra publish. Exclude only what the Dockerfile does not COPY.

cd "$(git rev-parse --show-toplevel)"

tab=$(printf '\t')
excluded="${tab}infrastructure/runpod/(tests/|scripts/|[^/]*\.md$|\.flake8$|\.gitignore$|Dockerfile\.local$|local\.env$|local_server\.py$|requirements-dev\.txt$)"

# `git ls-tree` hashes tracked content only, so a local __pycache__ or venv
# can never change the tag.
listing=$(git ls-tree -r HEAD -- infrastructure/runpod | grep -vE "$excluded")

for required in Dockerfile requirements.txt handler/main.py; do
  if ! printf '%s\n' "$listing" | grep -q "${tab}infrastructure/runpod/${required}$"; then
    echo "runpod-image-tag: infrastructure/runpod/$required is not among the inputs:" >&2
    printf '%s\n' "$listing" >&2
    exit 1
  fi
done

hash=$(printf '%s\n' "$listing" | git hash-object --stdin)
echo "src-${hash:0:12}"
