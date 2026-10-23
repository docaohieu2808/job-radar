# Lists .vn domains that have a careers / recruitment page in the latest Common Crawl crawl, from its public
# columnar index (an open dataset published for bulk use). Reads Parquet footers first, then only the files whose
# url_host_tld range includes "vn": about 8 minutes and a few hundred MB per crawl. Output: "domain<TAB>url" lines.
# Run by tools/common-crawl-import.sh; the crawler's candidate filter then decides which are IT companies.
import duckdb, gzip, json, sys, time, urllib.request

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
    lo, hi = con.execute(f"select min(stats_min_value), max(stats_max_value) from parquet_metadata('{p}') where path_in_schema='url_host_tld'").fetchone()
    if lo and hi and lo <= "vn" <= hi:
        files.append(p)
print(f"# {len(files)} of {len(paths)} files hold .vn hosts ({time.time()-t:.0f}s)", file=sys.stderr)
lst = ",".join(f"'{p}'" for p in files)
rows = con.execute(f"""
  select url_host_registered_domain d, min(url) u
  from read_parquet([{lst}])
  where url_host_tld = 'vn'
    and regexp_matches(lower(url_path), '(tuyen-dung|tuyendung|careers?|recruit|co-hoi-nghe-nghiep|viec-lam|talent-acquisition|jobs?)(/|$|\\.)')
  group by 1""").fetchall()
for d, u in rows:
    print(f"{d}\t{u}")
print(f"# {len(rows)} domains, {time.time()-t:.0f}s total", file=sys.stderr)
