# Lists public ATS job boards (Greenhouse, Lever, Ashby) seen in the latest Common Crawl crawl, from its public
# columnar index. The index is sorted by SURT key ("io,greenhouse,boards)/acme/..."), so only the files whose key
# range covers those hosts are read. Output: "kind<TAB>board" lines for `cli.js import-ats-boards`.
import duckdb, gzip, json, sys, time, urllib.request

HOSTS = {  # SURT prefix -> ATS kind
    "io,greenhouse,boards)/": "greenhouse",
    "io,greenhouse,job-boards)/": "greenhouse",
    "co,lever,jobs)/": "lever",
    "com,ashbyhq,jobs)/": "ashby",
}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "JobRadar/1.0 (personal job search)"}), timeout=120) as r:
        return r.read()

crawl = sys.argv[1] if len(sys.argv) > 1 else json.loads(get("https://index.commoncrawl.org/collinfo.json"))[0]["id"]
print(f"# crawl {crawl}", file=sys.stderr)
listing = gzip.decompress(get(f"https://data.commoncrawl.org/crawl-data/{crawl}/cc-index-table.paths.gz")).decode()
paths = ["https://data.commoncrawl.org/" + l.strip() for l in listing.splitlines() if "subset=warc" in l]
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET threads=4")
t = time.time()
files = []
for p in paths:
    lo, hi = con.execute(f"select min(stats_min_value), max(stats_max_value) from parquet_metadata('{p}') where path_in_schema='url_surtkey'").fetchone()
    if lo and hi and any(lo <= prefix + "￿" and prefix <= hi for prefix in HOSTS):
        files.append(p)
print(f"# {len(files)} of {len(paths)} files cover ATS hosts ({time.time()-t:.0f}s)", file=sys.stderr)
lst = ",".join(f"'{p}'" for p in files)
cond = " or ".join(f"starts_with(url_surtkey, '{prefix}')" for prefix in HOSTS)
rows = con.execute(f"""
  select url_host_name h, lower(split_part(url_path, '/', 2)) board
  from read_parquet([{lst}]) where ({cond})
  group by 1, 2""").fetchall()
seen = set()
for host, board in rows:
    kind = "lever" if "lever" in host else "ashby" if "ashby" in host else "greenhouse"
    if board and board not in ("embed", "v1", "api", "favicon.ico", "robots.txt") and (kind, board) not in seen:
        seen.add((kind, board))
        print(f"{kind}\t{board}")
print(f"# {len(seen)} boards, {time.time()-t:.0f}s total", file=sys.stderr)
