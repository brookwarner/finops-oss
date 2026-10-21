#!/usr/bin/env python3
"""Run SQL files / statements against Supabase via pg8000.

Connection details come from env:
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

Usage:
    run_sql.py file <path1> [<path2> ...]
    run_sql.py exec "<sql>"
"""
import os
import sys
import glob
import pg8000.dbapi


def connect():
    return pg8000.dbapi.connect(
        host=os.environ["PGHOST"],
        port=int(os.environ.get("PGPORT", "5432")),
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        database=os.environ.get("PGDATABASE", "postgres"),
        ssl_context=True,
    )


def main() -> None:
    mode = sys.argv[1]
    conn = connect()
    conn.autocommit = True
    cur = conn.cursor()
    if mode == "file":
        paths: list[str] = []
        for arg in sys.argv[2:]:
            paths.extend(sorted(glob.glob(arg)))
        for p in paths:
            with open(p) as f:
                sql = f.read()
            cur.execute(sql)
            print(f"applied {os.path.basename(p)} (rowcount={cur.rowcount})")
    elif mode == "exec":
        cur.execute(sys.argv[2])
        try:
            rows = cur.fetchall()
            for r in rows:
                print(r)
        except Exception:
            print(f"rowcount={cur.rowcount}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
