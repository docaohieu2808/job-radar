#!/bin/bash
# Temporarily lifts the crawler's limits to clear a backlog (e.g. after a big Common Crawl import), then restores
# the compose defaults once the backlog is done or after a deadline, whichever comes first.
# Usage: tools/backlog-boost.sh [max-hours]   (run it under systemd-run so it survives the session)
set -euo pipefail
cd "$(dirname "$0")/.."
max_hours=${1:-6}
CRAWLER_CONCURRENCY=16 docker compose up -d crawler
docker update --cpus 3 --memory 3g --memory-swap 3g job-radar-crawler-1
echo "boosted: 3 CPU, 3 GB, 16 tasks; reverting when the backlog clears or after ${max_hours} h"
deadline=$(( $(date +%s) + max_hours * 3600 ))
backlog() {
  docker compose exec -T db psql -U jobradar -d jobradar -At -c "
    SELECT (SELECT count(*) FROM crawl_queue WHERE kind = 'candidate-check' AND done_at IS NULL AND next_fetch_at <= now())
         + (SELECT count(*) FROM career_pages p JOIN companies c ON c.id = p.company_id
             WHERE c.discovered_via = 'ats' AND p.last_fetched_at IS NULL AND p.status <> 'error')"
}
while [ "$(date +%s)" -lt "$deadline" ]; do
  left=$(backlog || echo 99999)
  echo "$(date '+%F %T') backlog $left"
  [ "$left" -lt 200 ] && break
  sleep 300
done
docker compose up -d crawler
echo "restored compose limits"
