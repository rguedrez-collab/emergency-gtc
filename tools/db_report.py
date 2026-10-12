"""Read the gateway's SQLite database: vacations, calls and transcripts.

  python3 tools/db_report.py                     # vacations and calls (newest first)
  python3 tools/db_report.py --transcript TEST-3 # one call's transcript
  python3 tools/db_report.py --csv calls.csv     # export the calls table
Database path: ORANGE_DB_PATH, else state/orange.db at the repository root.
"""
import argparse
import csv
import os
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("ORANGE_DB_PATH", str(REPO / "state" / "orange.db")))


def when(epoch):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch)) if epoch else "-"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--transcript", metavar="CALL_ID", help="print the transcript of one call")
    parser.add_argument("--csv", metavar="FILE", help="export the calls table")
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()
    if not DB.exists():
        sys.exit(f"no database at {DB}")
    try:
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        conn.execute("SELECT 1 FROM snapshot LIMIT 1")
    except sqlite3.OperationalError:
        # A WAL database owned by another user (e.g. a container volume) cannot create its -shm index: read it as-is.
        conn = sqlite3.connect(f"file:{DB}?mode=ro&immutable=1", uri=True)
    conn.row_factory = sqlite3.Row
    if args.transcript:
        rows = conn.execute("SELECT who, text, ts, source FROM turns WHERE call_id = ? ORDER BY base, idx", (args.transcript,)).fetchall()
        if not rows:
            sys.exit(f"no transcript for {args.transcript}")
        for r in rows:
            print(f"{r['ts'] or '':>6}  {r['who']:<10} {r['text']}")
        return
    if args.csv:
        rows = conn.execute("SELECT * FROM calls ORDER BY started_at").fetchall()
        with open(args.csv, "w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(rows[0].keys() if rows else [])
            writer.writerows([tuple(r) for r in rows])
        print(f"{len(rows)} calls -> {args.csv}")
        return
    print(f"database: {DB}")
    print("\nvacations")
    for r in conn.execute("SELECT * FROM vacations ORDER BY updated_at DESC LIMIT ?", (args.limit,)):
        print(f"  {when(r['started_at'])}  vacation {r['id']}  {r['status']:<10} arrivés {r['launched']}  terminés {r['finished']}  échecs {r['failed']}")
    print("\ncalls")
    for r in conn.execute("SELECT * FROM calls ORDER BY started_at DESC LIMIT ?", (args.limit,)):
        state = "dossier clos" if r["reviewed"] else (r["end_label"] or r["phase"] or "")
        print(f"  {when(r['started_at'])}  {r['id']:<9} {(r['category'] or ''):<34} {r['turns']:>3} tours  {state}")
    total = conn.execute("SELECT count(*) FROM calls").fetchone()[0]
    turns = conn.execute("SELECT count(*) FROM turns").fetchone()[0]
    print(f"\n{total} calls, {turns} transcript turns")


if __name__ == "__main__":
    main()
