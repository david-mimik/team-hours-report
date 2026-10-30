import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ChartBlock } from '../report/types';

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--rs-series-${n})`);

// Colours that mean something keep it on every chart: SDLC phases (as on the Team Time page), workflow statuses,
// and the roles of agile chart lines.
const NAMED: [RegExp, string][] = [
  [/^requirements$/i, 'var(--rs-p1)'], [/^design$/i, 'var(--rs-p2)'], [/^development$/i, 'var(--rs-p3)'],
  [/^testing$/i, 'var(--rs-p4)'], [/^fixing defects$/i, 'var(--rs-p5)'], [/^planning & process$/i, 'var(--rs-p6)'], [/^unclassified$/i, 'var(--rs-p7)'],
  [/^highest$|^blocker$|^critical$/i, 'var(--rs-prio-1)'], [/^high$|^major$/i, 'var(--rs-prio-2)'], [/^medium$/i, 'var(--rs-prio-3)'],
  [/^low$|^minor$/i, 'var(--rs-prio-4)'], [/^lowest$|^trivial$/i, 'var(--rs-prio-5)'],
  [/^(ideal|guideline)/i, 'var(--rs-ideal)'], [/^scope/i, 'var(--rs-scope)'], [/^(committed|commitment|estimated)/i, 'var(--rs-committed)'],
  [/^(completed|done)$/i, 'var(--rs-done)'], [/^remaining/i, 'var(--rs-series-1)'], [/^logged/i, 'var(--rs-series-4)'],
  [/to ?do|backlog|open|new/i, 'var(--rs-status-todo)'], [/block/i, 'var(--rs-status-blocked)'],
  [/progress|doing|review/i, 'var(--rs-status-doing)'], [/fixed|ready|qa|merge|test/i, 'var(--rs-status-ready)'], [/done|closed|resolved/i, 'var(--rs-done)'],
];
const colorOf = (name: unknown, i: number) => {
  const n = String(name).trim();
  const hit = NAMED.find(([re]) => re.test(n));
  return hit ? hit[1] : PALETTE[i % PALETTE.length];
};

// Slices under 3% get no label, so small ones do not pile up on each other.
const pieLabel = ({ percent, value }: { percent?: number; value?: number }) => ((percent ?? 0) >= 0.03 ? value : '');

const SUBTITLE: Partial<Record<ChartBlock['kind'], string>> = {
  burndown: 'Remaining work per day against the ideal line. Above the line: behind plan.',
  burnup: 'Work completed per day against the sprint’s scope. A rising scope line is scope added mid-sprint.',
  velocity: 'Work committed at sprint start vs completed by its end.',
  cfd: 'Tickets in each column per day. Widening middle bands mean work is piling up.',
  controlChart: 'Days from first “in progress” to resolved, one dot per ticket.',
};

const axis = { fontSize: 12, fill: 'var(--rs-muted)' };

// One value against its full scale: a half ring, the value in the middle, 0 and max at the ends.
function Gauge({ value, max, label, fmt }: { value: number; max: number; label: string; fmt: (v: unknown) => string }) {
  const share = Math.max(0, Math.min(1, value / (max || 1)));
  const pct = Math.round((100 * value) / (max || 1));
  const color = pct > 100 ? 'var(--rs-scope)' : 'var(--rs-accent)';
  return (
    <div className="gauge">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={[{ v: share }, { v: 1 - share }]} dataKey="v" startAngle={180} endAngle={0} cx="50%" cy="85%" innerRadius="105%" outerRadius="140%" stroke="none" isAnimationActive={false}>
            <Cell fill={color} /><Cell fill="var(--rs-surface-2)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="gauge-value"><b>{fmt(value)}</b><span>{pct}% of {fmt(max)}{label ? ` · ${label}` : ''}</span></div>
      <div className="gauge-ends"><span>0</span><span>{fmt(max)}</span></div>
    </div>
  );
}

export function Chart({ title, subtitle, kind, xKey, series, data: rawData, unit, lineSeries, referenceLines, max, width }: ChartBlock) {
  // percentBar: each row as shares of its total; the counts stay on the row for the tooltip
  const percent = kind === 'percentBar';
  const data = percent ? rawData.map((row) => {
    const total = series.reduce((a, k) => a + (Number(row[k]) || 0), 0) || 1;
    const out: Record<string, unknown> = { ...row };
    series.forEach((k) => { out[k] = Math.round((1000 * (Number(row[k]) || 0)) / total) / 10; out[`__n_${k}`] = row[k]; });
    return out;
  }) : rawData;
  const fmt = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString('en-US')}${unit && !percent ? ` ${unit}` : ''}` : String(v ?? '–'));
  const tip = (v: unknown, name: unknown, item: { payload?: Record<string, unknown> }) => (percent
    ? `${v}% (${item.payload?.[`__n_${String(name)}`] ?? '–'}${unit ? ` ${unit}` : ''})` : fmt(v));
  const note = subtitle || SUBTITLE[kind];
  const height = kind === 'horizontalBar' || percent ? Math.max(220, data.length * (series.length > 1 && !percent ? 22 * series.length : 32) + 60) : 300;

  if (kind === 'gauge') {
    const row = data[0] || {};
    const value = Number(row[series[0]] ?? 0);
    return (
      <section className="block">
        <h3>{title}</h3>
        {note && <p className="chart-note">{note}</p>}
        <Gauge value={value} max={max ?? value} label={String(row[xKey] ?? '')} fmt={fmt} />
      </section>
    );
  }

  if (kind === 'pie' || kind === 'donut') {
    const total = data.reduce((a, row) => a + (Number(row[series[0]]) || 0), 0) || 1;
    const wide = width === 'full' || width === undefined;
    const legend = (name: unknown) => {
      const row = data.find((r) => String(r[xKey]) === String(name));
      const v = Number(row?.[series[0]]) || 0;
      return `${String(name)} · ${fmt(v)} (${Math.round((100 * v) / total)}%)`;
    };
    return (
      <section className="block">
        <h3>{title}</h3>
        {note && <p className="chart-note">{note}</p>}
        <ResponsiveContainer width="100%" height={(kind === 'donut' ? 220 : 240) + Math.ceil(data.length / (wide ? 3 : 2)) * 20}>
          <PieChart margin={{ top: 8, bottom: 8 }}>
            <Pie data={data} dataKey={series[0]} nameKey={xKey} cx="50%" cy={kind === 'donut' ? 104 : 116} outerRadius={kind === 'donut' ? 90 : 100} innerRadius={kind === 'donut' ? 58 : 0} label={kind === 'pie' ? pieLabel : false} labelLine={false} paddingAngle={kind === 'donut' ? 1 : 0} isAnimationActive={false}>
              {data.map((row, i) => <Cell key={i} fill={colorOf(row[xKey], i)} />)}
            </Pie>
            {kind === 'donut' && (
              <text x="50%" y={104} textAnchor="middle" className="donut-total">
                <tspan x="50%" dy="2">{total.toLocaleString('en-US')}</tspan>
                {unit && <tspan x="50%" dy="18" className="donut-unit">{unit}</tspan>}
              </text>
            )}
            <Tooltip formatter={fmt} />
            <Legend formatter={legend} wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </section>
    );
  }

  const horizontal = kind === 'horizontalBar' || percent;
  const lines = new Set(lineSeries || []);
  const element = (s: string, i: number) => {
    const color = colorOf(s, i);
    const common = { key: s, dataKey: s, name: s, isAnimationActive: false } as const;
    const dashed = /^(ideal|guideline)/i.test(s);
    switch (kind) {
      case 'stackedBar': return <Bar {...common} stackId="s" fill={color} />;
      case 'percentBar':
        return (
          <Bar {...common} stackId="s" fill={color}>
            <LabelList dataKey={s} position="center" formatter={(v: unknown) => (Number(v) >= 8 ? `${v}%` : '')} style={{ fill: '#fff', fontSize: 11, fontWeight: 600 }} />
          </Bar>
        );
      case 'bar': case 'horizontalBar': return <Bar {...common} fill={color} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />;
      case 'stackedArea': case 'cfd': return <Area {...common} stackId="s" type="monotone" stroke={color} fill={color} fillOpacity={0.85} />;
      case 'area': return <Area {...common} type="monotone" stroke={color} fill={color} fillOpacity={0.2} strokeWidth={2} />;
      case 'scatter': case 'controlChart': return <Scatter {...common} fill={color} />;
      case 'combo': return lines.has(s) ? <Line {...common} type="monotone" stroke={color} strokeWidth={2} dot={false} /> : <Bar {...common} fill={color} radius={[4, 4, 0, 0]} />;
      case 'velocity':
        return /^logged/i.test(s) ? <Line {...common} type="monotone" stroke={color} strokeWidth={2} strokeDasharray="5 4" />
          : <Bar {...common} fill={color} radius={[4, 4, 0, 0]} />;
      case 'burnup':
        if (/^(completed|done)$/i.test(s)) return <Area {...common} type="stepAfter" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} />;
        return <Line {...common} type={dashed ? 'linear' : 'stepAfter'} stroke={color} strokeWidth={2} strokeDasharray={dashed || /^logged/i.test(s) ? '6 4' : undefined} dot={false} />;
      case 'burndown':
        return <Line {...common} type={dashed ? 'linear' : 'stepAfter'} stroke={color} strokeWidth={dashed ? 1.5 : 2.5} strokeDasharray={dashed ? '6 4' : undefined} dot={false} />;
      default: return <Line {...common} type="monotone" stroke={color} strokeWidth={2} dot={data.length <= 24} />;
    }
  };

  return (
    <section className="block">
      <h3>{title}</h3>
      {note && <p className="chart-note">{note}</p>}
      <div className="chart">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--rs-grid)" vertical={false} horizontal={!horizontal} />
            {horizontal
              ? <><XAxis type="number" tick={axis} domain={percent ? [0, 100] : undefined} ticks={percent ? [0, 25, 50, 75, 100] : undefined} allowDataOverflow={percent} unit={percent ? '%' : undefined} /><YAxis type="category" dataKey={xKey} tick={axis} width={150} /></>
              : <><XAxis dataKey={xKey} tick={axis} minTickGap={12} /><YAxis tick={axis} width={52} unit={unit && unit.length <= 2 ? unit : undefined} /></>}
            <Tooltip formatter={tip as never} cursor={{ fill: 'var(--rs-surface-2)', fillOpacity: 0.5 }} />
            <Legend />
            {series.map(element)}
            {(referenceLines || []).map((r) => (
              <ReferenceLine key={r.label} y={r.y} stroke="var(--rs-muted)" strokeDasharray="4 4" label={{ value: `${r.label} (${fmt(r.y)})`, position: 'insideTopRight', fill: 'var(--rs-muted)', fontSize: 12 }} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
