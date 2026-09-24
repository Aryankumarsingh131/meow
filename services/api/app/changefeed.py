"""T14 commit-ordered change allocation.

system-design.md: "A per-tenant locked `sync_heads` row allocates change
sequence numbers in the same commit as the mutation ... A bare global database
sequence can be allocated before commit and make cursor clients miss a
late-committing row; do not implement that shortcut."

`record_change` must run INSIDE the mutation's transaction and BEFORE its
other writes. The `UPDATE ... RETURNING` takes the tenant's row lock and holds
it until commit/rollback, so within a tenant sequence order == commit order: a
reader that sees seq N committed can never later see a seq < N appear.
"""

from __future__ import annotations

from typing import Any, Literal

from .samples import sql

EntityType = Literal["sample"]
Operation = Literal["upsert", "tombstone"]


def record_change(
    connection: Any,
    tenant_id: str,
    entity_type: EntityType,
    entity_id: str,
    operation: Operation,
    version: int,
    committed_at: str,
) -> int:
    """Allocate the tenant's next sequence under its row lock and log the change."""
    cursor = connection.cursor()
    # First mutation for a tenant creates its head. Concurrent creators block on
    # the primary key until the winner commits, then do nothing.
    cursor.execute(
        sql(
            "INSERT INTO sync_heads (tenant_id, next_seq, floor_seq) VALUES (?, 1, 0) "
            "ON CONFLICT (tenant_id) DO NOTHING",
            connection,
        ),
        (tenant_id,),
    )
    # ponytail: one serial lock per tenant is the documented pilot ceiling
    # (system-design.md); replace only after hot-tenant measurements justify it.
    cursor.execute(
        sql(
            "UPDATE sync_heads SET next_seq = next_seq + 1 WHERE tenant_id = ? RETURNING next_seq - 1",
            connection,
        ),
        (tenant_id,),
    )
    seq = int(cursor.fetchone()[0])
    cursor.execute(
        sql(
            "INSERT INTO changefeed (tenant_id,seq,entity_type,entity_id,operation,version,committed_at) "
            "VALUES (?,?,?,?,?,?,?)",
            connection,
        ),
        (tenant_id, seq, entity_type, entity_id, operation, version, committed_at),
    )
    return seq


def head(connection: Any, tenant_id: str) -> tuple[int, int]:
    """Return `(last committed seq, floor_seq)`; `(0, 0)` before any change."""
    cursor = connection.cursor()
    cursor.execute(
        sql("SELECT next_seq, floor_seq FROM sync_heads WHERE tenant_id = ?", connection),
        (tenant_id,),
    )
    row = cursor.fetchone()
    return (int(row[0]) - 1, int(row[1])) if row else (0, 0)


def compact(connection: Any, tenant_id: str, through_seq: int) -> None:
    """Drop feed rows up to `through_seq` and raise the floor, in one transaction.

    Cursors below the new floor then get 410 RESET_REQUIRED instead of a page
    with a silent hole in it. Entities themselves are untouched. Retention
    policy (when to call this) is T47's.
    """
    cursor = connection.cursor()
    cursor.execute(
        sql(
            "UPDATE sync_heads SET floor_seq = ? WHERE tenant_id = ? AND floor_seq < ? AND ? < next_seq",
            connection,
        ),
        (through_seq, tenant_id, through_seq, through_seq),
    )
    # Delete up to the floor actually stored, never up to the argument: a
    # rejected floor move must not delete rows that cursors still depend on.
    cursor.execute(
        sql(
            "DELETE FROM changefeed WHERE tenant_id = ? "
            "AND seq <= (SELECT floor_seq FROM sync_heads WHERE tenant_id = ?)",
            connection,
        ),
        (tenant_id, tenant_id),
    )
    connection.commit()
