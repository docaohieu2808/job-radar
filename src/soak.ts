// The one-week run from the plan, measured by the crawler itself: a row per day in daily_stats, and a verdict
// once seven days are in. Nobody has to remember to come back and measure.
import { pool } from "./db.js";

export const SOAK_DAYS = 7;
const MIN_HOSTS = 1000;
// 14 LinkedIn searches and at most 100 posting pages a day.
const LINKEDIN_DAILY_CEILING = 120;
// The busiest single host: the job boards are read at most every 20 s by design, about 4,300 times a day at the
// very most; in practice a few dozen.
const BUSIEST_HOST_CEILING = 500;
const MAX_ERROR_RATE = 0.2;

// Called hourly: refreshes today's row (Ho Chi Minh City day) and counts an idle hour when nothing ran.
export async function recordDay(): Promise<void> {
  await pool.query(
    `WITH day AS (SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS d),
          since AS (SELECT (d::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t FROM day),
          runs AS (SELECT coalesce(sum(fetched), 0) AS pages, coalesce(sum((detail->>'tasks')::int), 0) AS tasks, coalesce(sum(errors), 0) AS errors
                     FROM crawl_runs, since WHERE started_at >= since.t),
          per_host AS (SELECT host, count(*) AS n FROM crawl_queue, since WHERE last_run_at >= since.t GROUP BY host),
          busiest AS (SELECT host, n FROM per_host ORDER BY n DESC LIMIT 1),
          recent AS (SELECT count(*) AS n FROM crawl_queue WHERE last_run_at > now() - interval '1 hour')
     INSERT INTO daily_stats (day, pages, tasks, errors, hosts_worked, busiest_host, busiest_tasks, linkedin_tasks, idle_hours, companies, career_found, postings)
     SELECT day.d, runs.pages, runs.tasks, runs.errors,
            (SELECT count(*) FROM per_host), (SELECT host FROM busiest), coalesce((SELECT n FROM busiest), 0),
            coalesce((SELECT n FROM per_host WHERE host = 'www.linkedin.com'), 0),
            CASE WHEN (SELECT n FROM recent) = 0 THEN 1 ELSE 0 END,
            (SELECT count(*) FROM companies), (SELECT count(*) FROM companies WHERE career_status = 'found'), (SELECT count(*) FROM jobs)
       FROM day, runs
     ON CONFLICT (day) DO UPDATE SET pages = EXCLUDED.pages, tasks = EXCLUDED.tasks, errors = EXCLUDED.errors,
            hosts_worked = EXCLUDED.hosts_worked, busiest_host = EXCLUDED.busiest_host, busiest_tasks = EXCLUDED.busiest_tasks,
            linkedin_tasks = EXCLUDED.linkedin_tasks, idle_hours = daily_stats.idle_hours + EXCLUDED.idle_hours,
            companies = EXCLUDED.companies, career_found = EXCLUDED.career_found, postings = EXCLUDED.postings, recorded_at = now()`,
  );
}

export type SoakCheck = { label: string; ok: boolean; detail: string };
export type Soak = { days: number; target: number; startedOn: string | null; done: boolean; passed: boolean; checks: SoakCheck[] };

type Row = { day: Date; pages: number; tasks: number; errors: number; hosts_worked: number; busiest_host: string | null; busiest_tasks: number; linkedin_tasks: number; idle_hours: number; companies: number; career_found: number };

export async function soakStatus(): Promise<Soak> {
  const { rows } = await pool.query<Row>("SELECT * FROM daily_stats ORDER BY day LIMIT $1", [SOAK_DAYS]);
  const hosts = await pool.query<{ n: string }>("SELECT count(*) AS n FROM hosts");
  const totalTasks = rows.reduce((s, r) => s + r.tasks, 0);
  const totalErrors = rows.reduce((s, r) => s + r.errors, 0);
  const busiest = rows.reduce<Row | null>((b, r) => (!b || r.busiest_tasks > b.busiest_tasks ? r : b), null);
  const linkedin = Math.max(0, ...rows.map((r) => r.linkedin_tasks));
  const idle = rows.reduce((s, r) => s + r.idle_hours, 0);
  const rate = totalTasks ? totalErrors / totalTasks : 0;
  const checks: SoakCheck[] = [
    { label: "At least 1,000 hosts", ok: Number(hosts.rows[0].n) >= MIN_HOSTS, detail: `${Number(hosts.rows[0].n).toLocaleString("en-US")} hosts known` },
    { label: "No host over its daily budget", ok: (busiest?.busiest_tasks ?? 0) <= BUSIEST_HOST_CEILING && linkedin <= LINKEDIN_DAILY_CEILING,
      detail: `busiest ${busiest?.busiest_host ?? "none"} ${busiest?.busiest_tasks ?? 0} tasks in a day · LinkedIn at most ${linkedin}` },
    { label: "Errors under 20%", ok: rate < MAX_ERROR_RATE, detail: `${totalErrors.toLocaleString("en-US")} of ${totalTasks.toLocaleString("en-US")} tasks (${Math.round(rate * 100)}%)` },
    { label: "Crawler never stalled", ok: idle === 0, detail: idle ? `${idle} idle hours` : "work finished every hour" },
  ];
  const done = rows.length >= SOAK_DAYS;
  return {
    days: rows.length, target: SOAK_DAYS, startedOn: rows[0]?.day.toISOString().slice(0, 10) ?? null,
    done, passed: done && checks.every((c) => c.ok), checks,
  };
}
