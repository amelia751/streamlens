"""A compact read of a query result, for the model.

Five sample rows are easy to skip past. A glance is the distribution: first
and last (so a time series has its ends), min/max on numbers, a few distinct
values on everything else. The caption should come from this, not from a
second identical SELECT.
"""

from __future__ import annotations

from typing import Any


def _numeric(values: list[object]) -> list[float]:
    nums: list[float] = []
    for value in values:
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            nums.append(float(value))
    return nums


def glance(
    columns: list[str], types: list[str], rows: list[list[Any]]
) -> dict[str, Any]:
    """Summarise `rows` so a model can read them without scanning every cell."""
    payload: dict[str, Any] = {"row_count": len(rows), "columns": {}}
    if not rows or not columns:
        return payload

    payload["first"] = dict(zip(columns, rows[0]))
    payload["last"] = dict(zip(columns, rows[-1]))

    for index, name in enumerate(columns):
        values = [row[index] if index < len(row) else None for row in rows]
        nulls = sum(1 for value in values if value is None)
        column: dict[str, Any] = {"nulls": nulls}
        numbers = _numeric(values)
        if numbers:
            column["min"] = min(numbers)
            column["max"] = max(numbers)
        else:
            seen: list[object] = []
            for value in values:
                if value is None or value in seen:
                    continue
                seen.append(value)
                if len(seen) == 5:
                    break
            column["examples"] = seen
            column["distinct_in_sample"] = len({
                value for value in values if value is not None
            })
        if index < len(types):
            column["type"] = types[index]
        payload["columns"][name] = column
    return payload
