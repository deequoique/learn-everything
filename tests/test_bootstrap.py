from __future__ import annotations

from sqlalchemy import create_engine, inspect, text


def test_sqlite_migration_backfills_card_step_column():
    from learning_ext.bootstrap import _ensure_sqlite_columns

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE le_card (
                    id INTEGER PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    front VARCHAR NOT NULL,
                    back VARCHAR NOT NULL
                )
                """
            )
        )

    _ensure_sqlite_columns(engine)
    _ensure_sqlite_columns(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("le_card")}
    assert {"step", "due_order", "suspended"}.issubset(columns)
