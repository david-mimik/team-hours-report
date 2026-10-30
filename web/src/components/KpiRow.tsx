import type { KpisBlock } from '../report/types';

export function KpiRow({ title, items }: KpisBlock) {
  return (
    <section className="block">
      {title && <h3>{title}</h3>}
      <div className="kpis">
        {items.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">
              {k.value}
              {k.delta !== undefined && (
                <span className={k.delta >= 0 ? 'kpi-delta up' : 'kpi-delta down'}>
                  {k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta).toFixed(1)}%
                </span>
              )}
            </div>
            {k.caption && <div className="kpi-caption">{k.caption}</div>}
            {k.previous !== undefined && <div className="kpi-previous">{k.previousLabel || 'Previous'} <b>{k.previous}</b></div>}
          </div>
        ))}
      </div>
    </section>
  );
}
