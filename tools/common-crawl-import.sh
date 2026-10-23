#!/bin/bash
# Monthly, from the latest Common Crawl index: .vn sites with a careers page become discovery candidates, and
# public Greenhouse / Ashby boards become companies read through their APIs. Each scan runs in a throwaway Python
# container (DuckDB); the lists go to the crawler's CLI.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp)
trap 'rm -f "$out"' EXIT
docker run --rm --cpus 1 --memory 1500m -v "$PWD/tools/common-crawl-careers.py:/cc.py:ro" python:3.13-slim \
  sh -c "pip install -q --root-user-action=ignore duckdb==1.4.1 && python /cc.py" > "$out"
docker compose exec -T crawler node dist/src/cli.js import-candidates < "$out"
docker run --rm --cpus 1 --memory 1500m -v "$PWD/tools/common-crawl-ats.py:/cc.py:ro" python:3.13-slim \
  sh -c "pip install -q --root-user-action=ignore duckdb==1.4.1 && python /cc.py" > "$out"
docker compose exec -T crawler node dist/src/cli.js import-ats-boards < "$out"
