"""Read the gateway's SQLite database: vacations, calls, transcripts and the per-site latency log.

  python3 tools/db_report.py                     # vacations and calls (newest first)
  python3 tools/db_report.py --transcript TEST-3 # one call's transcript
  python3 tools/db_report.py --csv calls.csv     # export the calls table
  python3 tools/db_report.py --latency           # caller latency per site (median, p95) and the console's own steps
Database path: ORANGE_DB_PATH, else state/orange.db at the repository root.
"""
import argparse
import csv
import os
import sqlite3
import statistics
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("ORANGE_DB_PATH", str(REPO / "state" / "orange.db")))


def when(epoch):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch)) if epoch else "-"


def stats(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return "      -        -"
    return f"{round(statistics.median(values)):>7} {values[min(len(values) - 1, int(len(values) * 0.95))]:>8}"


def latency(conn, limit):
    try:
        rows = conn.execute("SELECT * FROM latency ORDER BY at DESC LIMIT ?", (limit,)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    if not rows:
        print("no latency samples yet (the browser posts one per turn to /api/latency)")
        return
    print(f"last {len(rows)} turns, newest {when(rows[0]['at'])}\n")
    print(f"{'site':<14}{'turns':>6} {'caller med':>10} {'p95':>8} {'network med':>11} {'p95':>8} {'llm med':>8} {'p95':>8} {'tts med':>8} {'p95':>8} {'fallbacks':>10}")
    for name in sorted({r["location"] for r in rows}, key=lambda n: (n == "local", n)):
        mine = [r for r in rows if r["location"] == name and r["caller_ms"] is not None]
        fallbacks = sum(1 for r in rows if r["requested"] == name and r["fallback"])
        print(f"{name:<14}{len(mine):>6} {stats(r['caller_ms'] for r in mine)} {stats(r['network_ms'] for r in mine):>20} "
              f"{stats(r['llm_ms'] for r in mine):>17} {stats(r['tts_ms'] for r in mine):>17} {fallbacks:>10}")
    print(f"\n{'console step':<14}{'n':>6} {'median':>10} {'p95':>8}")
    for key, label in (("stt_ms", "transcription"), ("analyze_ms", "analysis"), ("reply_tts_ms", "AI voice")):
        values = [r[key] for r in rows if r[key] is not None]
        print(f"{label:<14}{len(values):>6} {stats(values)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--transcript", metavar="CALL_ID", help="print the transcript of one call")
    parser.add_argument("--csv", metavar="FILE", help="export the calls table")
    parser.add_argument("--latency", action="store_true", help="caller latency per site from the latency table")
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
    if args.latency:
        print(f"database: {DB}")
        latency(conn, max(args.limit, 500))
        return
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
    try:
        samples = conn.execute("SELECT count(*) FROM latency").fetchone()[0]
    except sqlite3.OperationalError:
        samples = 0
    print(f"\n{total} calls, {turns} transcript turns, {samples} latency samples (--latency)")


if __name__ == "__main__":
    main()
