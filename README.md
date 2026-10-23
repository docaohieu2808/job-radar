# Job Radar

A personal job radar for a DevOps engineer in Ho Chi Minh City. It crawls the job boards and the career pages of the
companies behind them, scores every posting against the owner's criteria, and shows the result in a web inbox.

Self-hosted on one ARM node (Oracle Cloud, 4 OCPU / 24 GB) with Docker Compose. Private, tailnet-only.

## What it does

- **Sources:** LinkedIn (guest pages), ITviec, TopDev (API), VietnamWorks (API), the TopDev company directory for
  Ho Chi Minh City, and each company's own career page: Greenhouse, Lever, Workday and SmartRecruiters through their
  APIs, self-built pages through their job links.
- **Company registry that grows by itself:** every company seen in a posting is recorded; its website comes from
  TopDev, a VietnamWorks profile, a matching contact e-mail in the posting, or the owner. The career page is then
  found from the website.
- **Extraction and scoring:** salary, level and years, work mode, stack, English requirement, certification
  sponsorship and onsite-abroad offers are read with rules; every point of the 0–100 match carries its reason.
  The owner tunes category weights on the Settings screen and every stored posting is rescored.
- **Web inbox:** triage with Interested / Skip / Applied (keyboard `j k i s a o`, ⌘K, Undo), a drag-and-drop
  pipeline, filters, company pages, an overview of the market, and a health screen for every source.

## Architecture

The design follows the web crawler chapter of *System Design Interview* (Alex Xu, vol. 1), scaled to one user.

| Crawler building block | Here |
|---|---|
| Seed URLs | Job-board searches, the TopDev directory, and the company registry |
| URL frontier, politeness | `crawl_queue` in Postgres, claimed with `SELECT … FOR UPDATE SKIP LOCKED` together with the host row; each host has its own interval and pause |
| HTML downloader, robots.txt | Node `fetch`; robots.txt cached per host for a week and honoured on company sites |
| Content parser | One adapter per source; ATS JSON APIs; job links on self-built pages; a capped LLM fallback (Gemini through 9Router) only when postings are listed without links |
| Content seen? | SHA-256 of the main text of a page: unchanged pages are not parsed again and wait twice as long (1 day up to 7 days) |
| URL seen? | `(source, external_id)` of stored postings plus `rejected_postings`, so search pages do not send the crawler back to what was already read |
| Storage | Postgres 18: companies, career pages, hosts, queue, jobs, sources, applications, preferences |

Refusals (429/403) pause the host for 15 minutes, doubling with each refusal in a row up to 6 hours, without
spending the task's retry attempts; "Try now" on the Sources screen probes the host and lifts the pause.

Services: `db` (Postgres), `crawler` (worker loop), `web` (JSON API and the React screens), together limited to
1.5 CPU and 2 GB so they never compete with the other workloads on the node.

## Run

```sh
cp .env.example .env   # set POSTGRES_PASSWORD, DATABASE_URL, LLM_* (optional)
docker compose up -d --build
docker compose --profile test run --rm --build test   # unit and integration tests against a throwaway database
```

Operator commands: `docker compose exec crawler node dist/src/cli.js rescore | sync-companies | enqueue <kind> <url>`.

## Operations

- Health: `GET /health` answers 503 when no task has finished for six hours; the fleet status page probes it.
- Logs: container stdout, collected by Promtail into Loki.
- Backup: `pg_dump` in the node's nightly Kopia backup.
- Design source: `design/source/` (Claude Design export). Decisions and their reasons: `docs/design-decisions.md`.
