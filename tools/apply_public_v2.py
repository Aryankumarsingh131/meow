"""Apply one services/api/sql/public_v2/*.sql file to JALSAKSHI_DATABASE_URL.

Each file manages its own transaction. Never prints the credential.

    python tools/apply_public_v2.py 002_hardening.sql
"""

import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]


def database_url() -> str:
    url = os.environ.get("JALSAKSHI_DATABASE_URL")
    if not url:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("JALSAKSHI_DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    if not url:
        sys.exit("JALSAKSHI_DATABASE_URL is not set")
    return url


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sql = (ROOT / "services/api/sql/public_v2" / sys.argv[1]).read_text(encoding="utf-8")
    with psycopg.connect(database_url(), connect_timeout=45, autocommit=True) as conn:
        conn.execute(sql)
    print(f"applied {sys.argv[1]}")


if __name__ == "__main__":
    main()
