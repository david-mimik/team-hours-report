import { useMemo, useState } from 'react';
import { autoGran, fmt, logsIn, pct, periodsIn, PHASES, plusD, UNCL, DD, type Data, type Gran, type Person, type Range } from './model';
import type { State } from './state';
import { SortTh, sortRows, tip, Who } from './ui';

type Props = { data: Data; rg: Range; today: string; people: Person[]; st: State; set: (p: Partial<State>) => void };
type Cell = { h: number; ph: number[] };

const zero = () => PHASES.map(() => 0);
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const phaseTip = (i: number, amount?: string) => tip(PHASES[i].name, `${PHASES[i].desc} Source: ${PHASES[i].source}.`, amount);

function Delta({ now, before, kind, unit, lowerIsBetter }: { now: number; before: number; kind: 'pct' | 'n' | 'pts'; unit: string; lowerIsBetter?: boolean }) {
  if (!before && kind !== 'pts') return null;
  const d = kind === 'pct' ? Math.round((100 * (now - before)) / before) : Math.round(now - before);
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const cls = lowerIsBetter ? (d > 0 ? 'down' : d < 0 ? 'up' : 'flat') : `${dir} neutral`;
  return (
    <span className={`delta ${cls}`} {...tip('Compared with the previous period', lowerIsBetter ? 'Lower is better: less time whose phase is unknown.' : `Same number of days just before the ${unit}s shown.`)}>
      {d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d)}{kind === 'pct' ? '%' : kind === 'pts' ? ' pts' : ''}
    </span>
  );
}

function Stack({ ph, whose }: { ph: number[]; whose: string }) {
  const t = sum(ph) || 1;
  return (
    <div className="stack">
      {ph.map((v, i) => (v > 0 ? <span key={i} {...phaseTip(i, `${fmt(v)} · ${pct(v, t)}% of ${whose}`)} style={{ flex: v, background: PHASES[i].color }} /> : null))}
    </div>
  );
}

function Donut({ tot, T }: { tot: number[]; T: number }) {
  const R = 118, r0 = 72, cx = 130, cy = 130;
  const p = (a: number, rr: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arc = (a0: number, a1: number) => {
    const L = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r0), [x3, y3] = p(a0, r0);
    return `M${x0},${y0}A${R},${R} 0 ${L} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${L} 0 ${x3},${y3}Z`;
  };
  let ang = -Math.PI / 2;
  return (
    <svg className="donut" viewBox="0 0 260 260" role="img" aria-label="Hours by SDLC phase">
      {tot.map((v, i) => {
        if (!v) return null;
        const a0 = ang, a1 = ang + (2 * Math.PI * v) / T;
        ang = a1;
        // a single phase is a full ring: two half arcs
        const d = v === T ? arc(-Math.PI / 2, Math.PI / 2) + arc(Math.PI / 2, (3 * Math.PI) / 2 - 0.001) : arc(a0, a1 - 0.012);
        return <path key={i} d={d} fill={PHASES[i].color} {...phaseTip(i, `${fmt(v)} · ${pct(v, T)}% of all hours`)} />;
      })}
      <text x="130" y="124" textAnchor="middle" fontSize="13" fill="var(--muted)">Total</text>
      <text x="130" y="146" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--fg)">{fmt(T)}</text>
    </svg>
  );
}

export function TimeByPhase({ data, rg, today, people, st, set }: Props) {
  const [showTickets, setShowTickets] = useState(false);
  const unit: Gran = st.tgran === 'auto' ? autoGran(rg) : st.tgran;
  const end = rg.b > today ? today : rg.b;

  const m = useMemo(() => {
    const ps = rg.a > end ? [] : periodsIn(data, unit, rg.a, end).map((p) => ({ ...p, sub: p.sub + (p.cb >= today ? ' · so far' : p.clipped && unit !== 'month' ? ' · part' : '') }));
    const sel = new Set(people.map((p) => p.i));
    const cells = new Map<number, Cell[]>(people.map((p) => [p.i, ps.map(() => ({ h: 0, ph: zero() }))]));
    const uncl = new Map<string, { min: number; who: Map<number, number> }>();
    let outside = 0;
    logsIn(data.logs, rg.a, end).forEach((l) => {
      if (!sel.has(l.p)) return;
      const k = ps.findIndex((x) => l.date >= x.ca && l.date <= x.cb);
      if (k < 0) { outside += l.min; return; }
      const c = cells.get(l.p)![k];
      c.h += l.min;
      c.ph[l.phase] += l.min;
      if (l.phase === UNCL) {
        const u = uncl.get(l.key) || { min: 0, who: new Map() };
        u.min += l.min;
        u.who.set(l.p, (u.who.get(l.p) || 0) + l.min);
        uncl.set(l.key, u);
      }
    });
    const rows = people.map((p) => ({ p, cells: cells.get(p.i)! })).filter((r) => r.cells.some((c) => c.h > 0));
    const silent = people.filter((p) => !p.former).length - rows.filter((r) => !r.p.former).length;
    // previous period: the same number of days just before
    const len = Math.round((DD(end).getTime() - DD(rg.a).getTime()) / 864e5) + 1;
    const prev = logsIn(data.logs, plusD(rg.a, -len), plusD(rg.a, -1)).filter((l) => sel.has(l.p)); // former members count only with time, as here
    const ptot = zero();
    prev.forEach((l) => { ptot[l.phase] += l.min; });
    const pPeople = new Set(prev.map((l) => l.p)).size;
    return { ps, rows, uncl, outside, ptot, pPeople, silent };
  }, [data, rg.a, end, unit, people, today]);

  const { ps, rows, uncl, ptot } = m;
  const tot = PHASES.map((_, i) => sum(rows.map((r) => sum(r.cells.map((c) => c.ph[i])))));
  const T = sum(tot), PT = sum(ptot);
  if (!ps.length || !T) {
    return <div className="panel card state">No hours logged by the selected people in this period.</div>;
  }
  const colTot = ps.map((_, k) => sum(rows.map((r) => r.cells[k].h)));
  const top = tot.slice(0, UNCL).indexOf(Math.max(...tot.slice(0, UNCL)));
  const unPct = pct(tot[UNCL], T);

  // sparkline of the total per period
  const mx = Math.max(...colTot, 1), W0 = 220, X = (k: number) => (k * (W0 - 8)) / Math.max(1, colTot.length - 1) + 4, Y = (v: number) => 24 - (20 * v) / mx;

  // mix per period and the phase that moved most
  const mixes = ps.map((per, k) => {
    const v = PHASES.map((_, i) => sum(rows.map((r) => r.cells[k].ph[i])));
    return { per, v, t: sum(v) || 1 };
  });
  let insight: React.ReactNode = null;
  if (mixes.length > 1) {
    const a = mixes[0], b = mixes[mixes.length - 1], ch = PHASES.map((_, i) => (100 * b.v[i]) / b.t - (100 * a.v[i]) / a.t);
    const i = ch.map(Math.abs).indexOf(Math.max(...ch.map(Math.abs)));
    insight = <div className="insight">💡 <span><b>{PHASES[i].name}</b> {ch[i] > 0 ? 'grew' : 'fell'} from {pct(a.v[i], a.t)}% in {a.per.name} to {pct(b.v[i], b.t)}% in {b.per.name}: the biggest change in the mix.</span></div>;
  }

  // the data gap: tickets with no phase, and whose time is on them
  const unTickets = [...uncl.entries()].sort((a, b) => b[1].min - a[1].min);
  const owners = new Map<number, number>();
  unTickets.forEach(([, u]) => u.who.forEach((v, p) => owners.set(p, (owners.get(p) || 0) + v)));
  const topOwners = [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => data.people[p].name);
  const listTickets = () => { setShowTickets(true); setTimeout(() => document.getElementById('unTickets')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); };

  const maxCell = Math.max(1, ...rows.flatMap((r) => r.cells.map((c) => c.h)));
  const heat = (h: number, max: number) => ({ background: `color-mix(in srgb, var(--accent) ${Math.round((28 * h) / max)}%, transparent)` });
  const sortT = (s: State['sortT']) => set({ sortT: s });

  return (
    <section>
      <div className="modebar">
        <span className="lbl">Columns</span>
        <div className="seg" role="group" aria-label="Columns">
          {(['auto', 'sprint', 'month', 'week'] as const).map((g) => (
            <button key={g} aria-pressed={st.tgran === g} onClick={() => set({ tgran: g })}>{g[0].toUpperCase() + g.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="verified">✓ Totals match Tempo to the minute: the same hours as the Hours view · synced {new Date(data.snap.asOf).toLocaleString()}</div>

      <div className="kpis">
        <div className="panel kpi">
          <div className="k">Hours logged</div>
          <div className="v">{fmt(T)}{st.cmp && <Delta now={T} before={PT} kind="pct" unit={unit} />}</div>
          <div className="s">{ps.length} {unit}{ps.length === 1 ? '' : 's'} · {ps[0].name} – {ps[ps.length - 1].name}{st.cmp ? ` · previous: ${fmt(PT)}` : ''}</div>
          {colTot.length > 1 && (
            <svg className="spark" width="100%" height="28" viewBox={`0 0 ${W0} 28`} preserveAspectRatio="none">
              <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={colTot.map((v, k) => `${X(k)},${Y(v)}`).join(' ')} />
              {colTot.map((v, k) => <circle key={k} r="3" fill="var(--accent)" cx={X(k)} cy={Y(v)} {...tip(ps[k].name, undefined, fmt(v))} />)}
            </svg>
          )}
        </div>
        <div className="panel kpi">
          <div className="k">People who logged time</div>
          <div className="v">{rows.length}{st.cmp && <Delta now={rows.length} before={m.pPeople} kind="n" unit={unit} />}</div>
          <div className="s">in the period{m.silent > 0 ? ` · ${m.silent} selected logged none` : ''}</div>
        </div>
        <div className="panel kpi">
          <div className="k">Largest phase</div>
          <div className="v">{PHASES[top].name}</div>
          <div className="s">{fmt(tot[top])} · {pct(tot[top], T)}% of all hours{st.cmp && PT > 0 && <Delta now={(100 * tot[top]) / T} before={(100 * ptot[top]) / PT} kind="pts" unit={unit} />}</div>
        </div>
        <div className="panel kpi">
          <div className="k">Unclassified</div>
          <div className="v">{unPct}%{st.cmp && PT > 0 && <Delta now={unPct} before={pct(ptot[UNCL], PT)} kind="pts" unit={unit} lowerIsBetter />}</div>
          <div className="s">hours whose phase Jira doesn’t say · <button className="linkbtn" onClick={listTickets}>list tickets</button></div>
        </div>
      </div>

      <div className="panel card">
        <h2>Where the time went</h2>
        <div className="note">Share of hours in each phase of the software development lifecycle, for the people and period selected.</div>
        {unPct >= 10 && (
          <div className="banner">⚠ <span><b>{fmt(tot[UNCL])} ({unPct}%) have no phase: their Jira tickets have no component, issue type or label that maps to one, nor does their parent.</b>
            {unTickets.length} tickets{topOwners.length ? `, most of the time logged by ${topOwners.join(', ')}` : ''}. Adding a component in Jira moves the hours to the right phase (after the next sync). <button className="linkbtn" onClick={listTickets}>List the {unTickets.length} tickets</button></span></div>
        )}
        <div className="donutwrap">
          <Donut tot={tot} T={T} />
          <div className="plist">
            {PHASES.map((ph, i) => (
              <div className="prow" key={i} {...phaseTip(i, `${fmt(tot[i])} · ${pct(tot[i], T)}%`)}>
                <i style={{ background: ph.color }} /><span>{ph.name}<small>{ph.desc}</small></span><span className="h">{fmt(tot[i])}</span><span className="pc">{pct(tot[i], T)}%</span>
              </div>
            ))}
            <div className="prow" style={{ borderTop: '2px solid var(--line)', borderRadius: 0, marginTop: 4 }}><i /><b>Total</b><span className="h">{fmt(T)}</span><span className="pc">100%</span></div>
          </div>
        </div>
        <table className="sr"><caption>Hours by SDLC phase</caption><tbody><tr><th>Phase</th><th>Hours</th><th>Share</th></tr>{PHASES.map((ph, i) => <tr key={i}><td>{ph.name}</td><td>{fmt(tot[i])}</td><td>{pct(tot[i], T)}%</td></tr>)}</tbody></table>
        {showTickets && (
          <div id="unTickets" style={{ marginTop: 16 }}>
            <div className="cardhead"><h2>Tickets with no phase · {unTickets.length}</h2><button className="btn" onClick={() => setShowTickets(false)}>Close</button></div>
            <div className="note">Most hours first. Open a ticket in Jira and add a component to classify its time.</div>
            <div className="scroll" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="tickets">
                <thead><tr><th>Ticket</th><th>Summary</th><th className="num">Hours</th><th>Logged by</th></tr></thead>
                <tbody>
                  {unTickets.map(([key, u]) => (
                    <tr key={key}>
                      <td className="key">{key.startsWith('#') ? key : <a href={`${data.snap.jiraBase}/browse/${key}`} target="_blank" rel="noreferrer">{key} ↗</a>}</td>
                      <td>{data.snap.issues[key]?.[0]}</td>
                      <td className="num">{fmt(u.min)}</td>
                      <td>{[...u.who.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => data.people[p].name).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="panel card">
        <h2>How the mix is changing</h2>
        <div className="note">Share of each phase per {unit} (100% = all hours in that {unit}). A phase that grows {unit} after {unit} is the signal to look at.</div>
        <div className="mix">
          {mixes.map(({ per, v, t }) => (
            <div className="mixrow" key={per.name + per.a}>
              <span><b>{per.name}</b><br /><span style={{ color: 'var(--muted)' }}>{per.sub}</span></span>
              <div className="bars">{v.map((x, i) => (x > 0 ? <span key={i} style={{ flex: x, background: PHASES[i].color }} {...phaseTip(i, `${fmt(x)} · ${pct(x, t)}% of ${per.name}`)} /> : null))}</div>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(t)}</span>
            </div>
          ))}
        </div>
        {insight}
      </div>

      <div className="panel card">
        <div className="cardhead">
          <div>
            <h2>Per {st.group === 'phase' ? 'SDLC phase' : 'person'}, per {unit}</h2>
            <div className="note">Hours logged in each {unit}, split by phase. Click a column title to sort; the Hours tab has every entry behind a number.</div>
          </div>
          <div className="tools">
            <label className="lbl">Group by <select value={st.group} onChange={(e) => set({ group: e.target.value as State['group'] })}><option value="person">Person</option><option value="phase">SDLC phase</option></select></label>
          </div>
        </div>
        <div className="scroll">
          {st.group === 'phase' ? (() => {
            const prow = PHASES.map((ph, i) => ({ i, name: ph.name, cells: ps.map((_, k) => sum(rows.map((r) => r.cells[k].ph[i]))) }));
            const maxP = Math.max(1, ...prow.flatMap((r) => r.cells));
            return (
              <table className="grid">
                <thead>
                  <tr><SortTh k="name" label="SDLC phase" sort={st.sortT} onSort={sortT} />{ps.map((p) => <th key={p.name + p.a} className="num">{p.name}<br /><span style={{ fontWeight: 400 }}>{p.sub}</span></th>)}<SortTh k="hours" label="Total per phase" className="num tcol" sort={st.sortT} onSort={sortT} /><th>Share</th></tr>
                  <tr className="totrow"><td>Total per {unit}</td>{colTot.map((v, k) => <td key={k} className="num" data-label={ps[k].name}>{fmt(v)}</td>)}<td className="num tcol" data-label="Total">{fmt(T)}</td><td data-label="Share">100%</td></tr>
                </thead>
                <tbody>
                  {sortRows(prow, st.sortT, (r) => r.name, (r) => sum(r.cells)).map((r) => {
                    const t = sum(r.cells);
                    return (
                      <tr key={r.i}>
                        <td><span {...phaseTip(r.i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: PHASES[r.i].color }} />{r.name}</span></td>
                        {r.cells.map((h, k) => <td key={k} className="num" data-label={ps[k].name} style={heat(h, maxP)}>{fmt(h)}</td>)}
                        <td className="num tcol" data-label="Total">{fmt(t)}</td>
                        <td data-label="Share"><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="stack" style={{ minWidth: 90, flex: 1 }}><span style={{ flex: t, background: PHASES[r.i].color }} /><span style={{ flex: Math.max(0.001, T - t), background: 'transparent' }} /></div><small>{pct(t, T)}%</small></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })() : (
            <table className="grid">
              <thead>
                <tr><SortTh k="name" label="Person" sort={st.sortT} onSort={sortT} />{ps.map((p) => <th key={p.name + p.a} className="num">{p.name}<br /><span style={{ fontWeight: 400 }}>{p.sub}</span></th>)}<SortTh k="hours" label="Total per person" className="num tcol" sort={st.sortT} onSort={sortT} /><th>By phase</th></tr>
                <tr className="totrow"><td>{st.teamOnly ? `Team · ${rows.length} people` : `Total per ${unit}`}</td>{colTot.map((v, k) => <td key={k} className="num" data-label={ps[k].name}>{fmt(v)}</td>)}<td className="num tcol" data-label="Total">{fmt(T)}</td><td data-label="By phase"><Stack ph={tot} whose="the team’s time" /></td></tr>
              </thead>
              <tbody>
                {!st.teamOnly && sortRows(rows, st.sortT, (r) => r.p.name, (r) => sum(r.cells.map((c) => c.h))).map((r) => {
                  const ph = PHASES.map((_, i) => sum(r.cells.map((c) => c.ph[i])));
                  return (
                    <tr key={r.p.i}>
                      <td><Who p={r.p} /></td>
                      {r.cells.map((c, k) => <td key={k} className="num" data-label={ps[k].name} style={heat(c.h, maxCell)}>{fmt(c.h)}</td>)}
                      <td className="num tcol" data-label="Total">{fmt(sum(r.cells.map((c) => c.h)))}</td>
                      <td data-label="By phase"><Stack ph={ph} whose="this person’s time" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {m.outside > 0 && <div className="foot">{fmt(m.outside)} logged in the period fall outside every {unit} shown (before the first sprint in Jira) and are left out of this table.</div>}
        <div className="foot">How phases are assigned: Jira component first (e.g. “Testing &amp; Quality Assurance” → Testing), then issue type (Bug → Fixing defects), then label (Testing, UX-UI), then the same rules on the parent ticket. Anything else is shown as Unclassified, never guessed.</div>
      </div>
    </section>
  );
}
