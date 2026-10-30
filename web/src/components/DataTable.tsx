import type { TableBlock } from '../report/types';

// "85.7%", "1,240" or 12 -> a number; anything else -> null
const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,%\s]|h$/g, ''));
  return String(v).trim() && Number.isFinite(n) ? n : null;
};

export function DataTable({ title, columns, rows, heatColumns }: TableBlock) {
  // shade the heat columns by value relative to the column's largest
  const heat = new Map((heatColumns || []).map((c) => {
    const j = columns.indexOf(c);
    return [j, Math.max(1e-9, ...rows.map((r) => num(r[j]) ?? 0))] as const;
  }).filter(([j]) => j >= 0));
  return (
    <section className="block">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => {
                const n = num(v);
                const max = heat.get(j);
                return (
                  <td key={j} className={n !== null ? 'num' : undefined}
                    style={max !== undefined && n !== null ? { background: `color-mix(in srgb, var(--rs-accent) ${Math.round(8 + 32 * Math.max(0, n) / max)}%, transparent)` } : undefined}>
                    {typeof v === 'number' ? v.toLocaleString('en-US') : v}
                  </td>
                );
              })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
