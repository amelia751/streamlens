export function DataTable({
  columns,
  rows,
  empty = "No rows.",
}: {
  columns: {
    key: string;
    label: string;
    align?: "left" | "right";
    render?: (r: Record<string, unknown>) => React.ReactNode;
  }[];
  rows: Record<string, unknown>[];
  empty?: string;
}) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.align === "right" ? "right" : "left" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{ textAlign: c.align === "right" ? "right" : "left" }}
                >
                  {c.render ? c.render(r) : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
