// Hours: an exact timesheet for closing a period. ISO weeks (Mon–Sun) split at month ends, every number a sum of
// Tempo worklogs in minutes. Scorecards compare with the previous period; no phase colours or check-ins. A forecast of
// the next 3 weeks is optional, shown apart and never added to a total or the export.
import { useMemo, useState } from 'react';
import {
  addMonths, dd, DD, forecastRange, forecastWeeks, inScope, isoWeek, logsIn, MON, MONL, minutesByPerson, monthEnd, plusD, prevRange, wdays,
  type Data, type Log, type Person, type Range,
} from './model';
import { rememberForecast, type State } from './state';
import { SortTh, sortRows, tip, toast, Who } from './ui';

type Props = { data: Data; rg: Range; today: string; st: State; set: (p: Partial<State>) => void };
type Col = { key: string; label: string; short?: string; sub: string; a: string; b: string; open: boolean; mstart?: boolean };
type Drill = { pi: number | null; a: string; b: string; proj?: string; title: string };

const dShort = (s: string) => MON[+s.slice(5, 7) - 1] + ' ' + +s.slice(8, 10);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// the ISO weeks that touch a month, clipped to the month and to the period
function weeksOf(ym: string, ra: string, rb: string, today: string) {
  const first = ym + '-01', last = monthEnd(ym), out: { w: number; a: string; b: string; open: boolean }[] = [];
  for (let mon = plusD(first, -((DD(first).getUTCDay() + 6) % 7)); mon <= last; mon = plusD(mon, 7)) {
    const sun = plusD(mon, 6);
    let a = mon < first ? first : mon, b = sun > last ? last : sun;
    if (a < ra) a = ra;
    if (b > rb) b = rb;
    if (a > b) continue;
    out.push({ w: isoWeek(mon), a, b, open: (mon <= today && today <= sun) || a > today });
  }
  return out;
}

export function Hours({ data, rg, today, st, set }: Props) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const fmtH = (m: number) => (st.format === 'dec' ? (m / 60).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.floor(m / 60) + ':' + String(Math.round(m) % 60).padStart(2, '0'));
  const hU = st.format === 'dec' ? ' h' : '';
  const nf = (v: number) => v.toLocaleString('en-US');

  const m = useMemo(() => {
    const months: string[] = [];
    for (let ym = rg.a.slice(0, 7); ym <= rg.b.slice(0, 7); ym = addMonths(ym, 1)) months.push(ym);
    const groups = months.map((ym) => ({ ym, weeks: weeksOf(ym, rg.a, rg.b, today) })).filter((g) => g.weeks.length);
    const cols: Col[] = st.hcols === 'month'
      ? groups.map((g) => {
        const last = monthEnd(g.ym), a = g.ym + '-01' < rg.a ? rg.a : g.ym + '-01', b = last > rg.b ? rg.b : last;
        return { key: g.ym, label: MON[+g.ym.slice(5, 7) - 1] + ' ' + g.ym.slice(0, 4), short: MON[+g.ym.slice(5, 7) - 1] + '\n' + g.ym.slice(0, 4), sub: a !== g.ym + '-01' || b !== last ? dShort(a) + '–' + +b.slice(8, 10) : '', a, b, open: b >= today };
      })
      : groups.flatMap((g) => g.weeks.map((wk, k) => ({
        key: wk.a, label: 'W' + wk.w + (wk.open ? '*' : ''), sub: dShort(wk.a) + '–' + (wk.a.slice(5, 7) === wk.b.slice(5, 7) ? String(+wk.b.slice(8, 10)) : dShort(wk.b)), a: wk.a, b: wk.b, open: wk.open, mstart: k === 0,
      })));

    // minutes per person per day per project
    const byDay = new Map<string, Log[]>();
    logsIn(data.logs, rg.a, rg.b).forEach((l) => { const k = l.p + '|' + l.date; (byDay.get(k) || byDay.set(k, []).get(k)!).push(l); });
    const span = (pi: number, a: string, b: string, proj?: string) => {
      let s = 0;
      for (let d = a; d <= b; d = plusD(d, 1)) (byDay.get(pi + '|' + d) || []).forEach((l) => { if (!proj || l.proj === proj) s += l.min; });
      return s;
    };
    // people: the shared rule (selected; former members when they logged time, so the total matches Tempo). An active
    // person with no time in the period is listed when they logged in the 90 days before it (a likely gap).
    const before = new Set(logsIn(data.logs, plusD(rg.a, -90), plusD(rg.a, -1)).map((l) => l.p));
    const people = data.people.map((p) => ({ p, tot: span(p.i, rg.a, rg.b) }))
      .filter((x) => inScope(x.p, x.tot, st.people) && (x.tot > 0 || before.has(x.p.i)));
    const projects = new Map<number, string[]>();
    logsIn(data.logs, rg.a, rg.b).forEach((l) => { const v = projects.get(l.p) || []; if (!v.includes(l.proj)) v.push(l.proj); projects.set(l.p, v); });
    const main = data.snap.projects[0];
    projects.forEach((v) => v.sort((x, y) => (x === main ? -1 : y === main ? 1 : x.localeCompare(y))));
    // the previous period (same number of days just before), with the same rule for who counts
    const pr = prevRange(rg, today);
    const prevBy = [...minutesByPerson(data.logs, pr.a, pr.b)].filter(([pi, mins]) => inScope(data.people[pi], mins, st.people) && mins > 0);
    // forecast history: each person's minutes in each of the last 8 full weeks
    const fw = forecastWeeks(today);
    const hist = fw.hist.map((h) => minutesByPerson(data.logs, h.a, h.b));
    return { groups, cols, span, people, projects, pr, prevBy, fw, hist };
  }, [data, rg.a, rg.b, st.hcols, st.people, today]);

  const { groups, cols, span, projects, pr, prevBy, fw, hist } = m;
  const rows = sortRows(m.people, st.sortH, (x) => x.p.name, (x) => x.tot);
  const grand = rows.reduce((a, x) => a + x.tot, 0);
  const cell = (pi: number, c: Col, proj?: string) => span(pi, c.a, c.b, proj);

  // scorecards, each against the previous period
  const nP = rows.filter((x) => x.tot > 0).length, avg = nP ? grand / nP : 0;
  const pGrand = prevBy.reduce((a, [, v]) => a + v, 0), pN = prevBy.length, pAvg = pN ? pGrand / pN : 0;
  const delta = (now: number, before: number, kind: 'pct' | 'n') => {
    if (!st.cmp || !before) return null;
    const d = kind === 'pct' ? Math.round((100 * (now - before)) / before) : Math.round(now - before);
    return <span className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'} neutral`} {...tip('Compared with the previous period', `${dd(pr.a)} – ${dd(pr.b)}: the same number of days just before the period.`)}>{d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d)}{kind === 'pct' ? '%' : ''}</span>;
  };

  // forecast: only when the period reaches this week; never in a total, a scorecard's logged hours or the export
  const fcAllowed = rg.b >= plusD(today, -7);
  const fcOn = st.forecast && fcAllowed;
  const fcMonths = st.hcols === 'month';
  const fcCols = fcMonths
    ? [{ name: `W${fw.next[0].w}–W${fw.next[2].w}`, a: fw.next[0].a, b: fw.next[2].b, n: 3 }]
    : fw.next.map((f) => ({ name: `W${f.w}`, a: f.a, b: f.b, n: 1 }));
  const fcSpan = (c: { a: string; b: string }) => dShort(c.a) + '–' + (c.a.slice(5, 7) === c.b.slice(5, 7) ? +c.b.slice(8, 10) : dShort(c.b));
  const personFc = (p: Person) => (p.former ? null : forecastRange(hist.map((h) => h.get(p.i) || 0)));
  // the team's range comes from its own weekly totals (adding people's ranges would overstate it)
  const activeRows = rows.filter((x) => !x.p.former).map((x) => x.p.i);
  const teamFc = forecastRange(hist.map((h) => activeRows.reduce((a, pi) => a + (h.get(pi) || 0), 0)));
  const toggleFc = (on: boolean) => {
    rememberForecast(on);
    set({ forecast: on });
    toast(on ? 'Forecast on: next 3 weeks, shown apart from the totals' : 'Forecast off');
    if (on) setTimeout(() => { const sc = document.querySelector('.hscroll'), th = document.querySelector<HTMLElement>('.sheet th.fc.fstart:not(.mhead)'); if (sc && th) sc.scrollTo({ left: Math.max(0, th.offsetLeft + 3 * th.offsetWidth - sc.clientWidth + 24), behavior: 'smooth' }); }, 50);
  };
  const fcCells = (who: string, r: { lo: number; mid: number; hi: number } | null) => (!fcOn ? null : fcCols.map((c, k) => {
    const cls = `fc${k ? '' : ' fstart'}`;
    if (!r) return <td key={c.name} className={cls} {...tip('No forecast', 'Former members are not forecast.')}>—</td>;
    const q = { lo: r.lo * c.n, mid: r.mid * c.n, hi: r.hi * c.n };
    return (
      <td key={c.name} className={cls} {...tip(`${who} · ${c.name} forecast (${fcSpan(c)})`, `Likely ${nf(q.lo)}–${nf(q.hi)} h${c.n > 1 ? ` over 3 weeks (${r.lo}–${r.hi} h a week)` : ''}, from the last 8 full weeks · median ${nf(q.mid)} h. Not added to any total.`, `${nf(q.lo)}–${nf(q.hi)} h`)}>
        {nf(q.lo)}–{nf(q.hi)}
      </td>
    );
  }));
  const blankFc = () => (!fcOn ? null : fcCols.map((c, k) => <td key={c.name} className={`fc${k ? '' : ' fstart'}`} />));

  // gaps: below 60% of the person's usual rate (median minutes per working day over the closed columns shown), or zero
  const wdTo = (c: Col) => { const b = c.b > today ? today : c.b; return c.a > b ? 0 : wdays(c.a, b); };
  const usual = new Map(rows.map((x) => {
    const rates = cols.filter((c) => !c.open && wdTo(c)).map((c) => cell(x.p.i, c) / wdTo(c)).sort((a, b) => a - b);
    return [x.p.i, rates.length ? rates[Math.floor(rates.length / 2)] : 0];
  }));
  const shade = (mins: number, c: Col, p: Person) => {
    if (p.former || (c.open && st.hcols === 'week') || !wdTo(c) || !usual.get(p.i)) return '';
    return mins === 0 ? ' zero' : mins < 0.6 * usual.get(p.i)! * wdTo(c) ? ' low' : '';
  };
  const projLabel = (pr0: string) => (pr0 === data.snap.projects[0] ? pr0 : `${pr0} (counts as ${data.snap.projects[0]})`);

  const numCell = (mins: number, c: Col, p: Person, proj?: string) => (c.a > today
    ? <td key={c.key} className="n open">–</td>
    : (
      <td key={c.key} className={`n hcell${proj ? '' : shade(mins, c, p)}${c.open ? ' open' : ''}${c.mstart ? ' mstart' : ''}`}
        {...tip(`${p.name} · ${c.label}${c.sub ? ` (${c.sub})` : ''}`, undefined, `${fmtH(mins)} h${proj ? ' on ' + proj : ''}, click for the entries`)}
        onClick={() => setDrill({ pi: p.i, a: c.a, b: c.b, proj, title: `${p.name} · ${c.a === c.b ? dShort(c.a) : dShort(c.a) + '–' + dShort(c.b)}${proj ? ' · ' + proj : ''}` })}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        {fmtH(mins)}
      </td>
    ));

  // one chart: total hours per month, next to the same days n months earlier (n = months shown)
  const back = (s0: string, n: number) => {
    const y = +s0.slice(0, 4), mo = +s0.slice(5, 7) - 1 - n, first = new Date(Date.UTC(y, mo, 1)), last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return first.toISOString().slice(0, 8) + String(Math.min(+s0.slice(8, 10), last)).padStart(2, '0');
  };
  const scopeSum = (a: string, b: string) => [...minutesByPerson(data.logs, a, b)].reduce((t, [pi, mins]) => t + (inScope(data.people[pi], mins, st.people) ? mins : 0), 0);
  const mt = groups.map((g) => {
    const last = monthEnd(g.ym), a = g.ym + '-01' < rg.a ? rg.a : g.ym + '-01', b = last > rg.b ? rg.b : last;
    const pa = back(a, groups.length), pb = back(b, groups.length);
    return { ym: g.ym, a, b, m: rows.reduce((s, x) => s + span(x.p.i, a, b), 0), part: a !== g.ym + '-01' || b !== last, pa, pb, pm: scopeSum(pa, pb) };
  });

  function exportCSV() {
    const L: string[][] = [['Person', ...cols.map((c) => c.label.replace('*', '') + (c.sub ? ` (${c.sub})` : '')), 'Total']];
    rows.forEach((x) => {
      L.push([x.p.name + (x.p.former ? ' (former)' : ''), ...cols.map((c) => (cell(x.p.i, c) / 60).toFixed(2)), (x.tot / 60).toFixed(2)]);
      const pj = projects.get(x.p.i) || [];
      if (pj.length > 1) pj.forEach((j) => L.push([`  ${x.p.name} · ${j}`, ...cols.map((c) => (cell(x.p.i, c, j) / 60).toFixed(2)), (span(x.p.i, rg.a, rg.b, j) / 60).toFixed(2)]));
    });
    L.push(['Total', ...cols.map((c) => (rows.reduce((a, x) => a + cell(x.p.i, c), 0) / 60).toFixed(2)), (grand / 60).toFixed(2)]);
    const csv = '﻿' + L.map((r) => r.map((v) => (/[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `team-hours-by-${st.hcols}_${rg.a}_to_${rg.b}.csv`;
    a.click();
    toast(`Exported ${rows.length} people · ${a.download}`);
  }

  const showDrill = (d: Drill) => { setDrill(d); setTimeout(() => document.getElementById('hDrill')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0); };
  const t3 = { lo: 3 * teamFc.lo, mid: 3 * teamFc.mid, hi: 3 * teamFc.hi };
  const endShown = rg.b > today ? today : rg.b;

  return (
    <section>
      <div className="panel card">
        <div className="cardhead">
          <div>
            <h2>{st.hcols === 'month' ? 'Hours per month' : 'Hours per week'}</h2>
            <div className="note" style={{ margin: '2px 0 0' }}>Exact hours logged in Tempo. Click a name, a {st.hcols} or any number to see the entries behind it.</div>
          </div>
          <div className="tools">
            <div className="seg" role="group" aria-label="Columns">
              <button aria-pressed={st.hcols === 'week'} onClick={() => { setDrill(null); set({ hcols: 'week' }); }}>Weeks</button>
              <button aria-pressed={st.hcols === 'month'} onClick={() => { setDrill(null); set({ hcols: 'month' }); }}>Months</button>
            </div>
            <label className="lbl">Format <select value={st.format} onChange={(e) => set({ format: e.target.value as State['format'] })}><option value="dec">0.00 h</option><option value="hm">h:mm</option></select></label>
            <button className="btn fcbtn" aria-pressed={fcOn} disabled={!fcAllowed} onClick={() => toggleFc(!st.forecast)}
              {...tip('Forecast next 3 weeks', fcAllowed
                ? 'Adds a likely range for each person for the 3 weeks after this one, from their last 8 full weeks. Shown apart, never added to a total or to the export.'
                : 'A forecast continues the period, so it is available when the period reaches this week. Pick a period that ends today, such as “Last 3 months”.')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l5-5 4 3 4-6" /><path d="M16 9l5-4" strokeDasharray="2 2.5" /></svg>
              Forecast next 3 weeks
            </button>
            <button className="btn" onClick={exportCSV} disabled={!rows.length}>⇩ Export table (CSV)</button>
          </div>
        </div>

        <div className="verified" style={{ marginTop: 12 }}>✓ Rows, columns and the total add up exactly and match Tempo to the minute: the same hours as Time by phase{cols.some((c) => c.open) && ` · the current ${st.hcols} is still open`}</div>

        <div className="kpis hk" role="group" aria-label="Summary">
          <div className="panel kpi"><div className="k">Total hours</div><div className="v">{fmtH(grand)}{hU}{delta(grand, pGrand, 'pct')}</div>
            <div className="s">{dd(rg.a)}, {rg.a.slice(0, 4)} – {dd(endShown)}, {endShown.slice(0, 4)}{st.cmp ? ` · previous: ${fmtH(pGrand)}${hU}` : ''}</div></div>
          <div className="panel kpi"><div className="k">People who logged time</div><div className="v">{nP}{delta(nP, pN, 'n')}</div>
            <div className="s">in the period{st.cmp ? ` · previous: ${pN}` : ''}</div></div>
          <div className="panel kpi"><div className="k">Average per person</div><div className="v">{fmtH(Math.round(avg))}{hU}{delta(avg, pAvg, 'pct')}</div>
            <div className="s">per person who logged time{st.cmp ? ` · previous: ${fmtH(Math.round(pAvg))}${hU}` : ''}</div></div>
          {fcOn && (
            <div className="panel kpi fckpi"><div className="k">Next 3 weeks · forecast</div><div className="v">{nf(t3.lo)}–{nf(t3.hi)} h</div>
              <div className="s">W{fw.next[0].w}–W{fw.next[2].w} · {dShort(fw.next[0].a)} – {dShort(fw.next[2].b)} · {teamFc.lo}–{teamFc.hi} h a week, from the last 8 full weeks · not in totals</div></div>
          )}
        </div>

        {mt.length > 1 && (() => {
          const cmp = st.cmp, f3 = fcOn ? { lo: t3.lo * 60, mid: t3.mid * 60, hi: t3.hi * 60 } : null;
          const W = 1000, H = 190, top = 22, bot = 26, left = 48, slots = mt.length + (f3 ? 1 : 0);
          const mx = Math.max(...mt.map((x) => Math.max(x.m, cmp ? x.pm : 0)), f3 ? f3.hi : 0, 60);
          const step = [50, 100, 200, 250, 500, 1000, 2000].find((s0) => mx / 60 / s0 <= 4) || 5000, top0 = Math.ceil(mx / 60 / step) * step;
          const y = (mins: number) => H - bot - ((H - top - bot) * (mins / 60)) / top0, bw = (W - left) / slots, w = Math.min(cmp ? 40 : 56, bw * (cmp ? 0.3 : 0.5));
          const grid: number[] = [];
          for (let v = 0; v <= top0; v += step) grid.push(v);
          const rng = (a: string, b: string) => dShort(a) + '–' + (a.slice(0, 7) === b.slice(0, 7) ? +b.slice(8, 10) : dShort(b));
          return (
            <figure className="hchart">
              <figcaption>
                <span>Total hours per month</span>
                <span className="hleg">
                  <span><i style={{ background: 'var(--accent)' }} />{MON[+mt[0].ym.slice(5, 7) - 1]}–{MON[+mt[mt.length - 1].ym.slice(5, 7) - 1]} {mt[mt.length - 1].ym.slice(0, 4)}</span>
                  {f3 && <span><i className="fcsw" />Forecast, next 3 weeks</span>}
                  {cmp && <span><i style={{ background: 'var(--cmp)' }} />Previous: {MON[+mt[0].pa.slice(5, 7) - 1]}–{MON[+mt[mt.length - 1].pa.slice(5, 7) - 1]} {mt[mt.length - 1].pa.slice(0, 4)}</span>}
                </span>
              </figcaption>
              <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Total hours per month">
                {f3 && <defs><pattern id="fcHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--accent-soft)" /><line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="2" /></pattern></defs>}
                {grid.map((v) => (
                  <g key={v}>
                    <line x1={left} x2={W} y1={y(v * 60)} y2={y(v * 60)} stroke="var(--line)" strokeDasharray={v ? '2 3' : undefined} />
                    <text x={left - 6} y={y(v * 60) + 4} textAnchor="end">{nf(v)}</text>
                  </g>
                ))}
                {mt.map((x, k) => {
                  const cx = left + k * bw + bw / 2, xc = cmp ? cx + 2 : cx - w / 2, xp = cx - w - 2, pct = x.pm ? Math.round((100 * (x.m - x.pm)) / x.pm) : null;
                  return (
                    <g key={x.ym} {...tip(MONL[+x.ym.slice(5, 7) - 1] + ' ' + x.ym.slice(0, 4) + (x.part ? ` (${rng(x.a, x.b)})` : ''),
                      cmp ? `Previous: ${rng(x.pa, x.pb)}, ${x.pa.slice(0, 4)} · ${fmtH(x.pm)} h${pct !== null ? ` · ${pct > 0 ? '+' : ''}${pct}%` : ''}` : undefined, `${fmtH(x.m)} h`)}>
                      {cmp && <rect x={xp} y={y(x.pm)} width={w} height={y(0) - y(x.pm)} rx="3" fill="var(--cmp)" />}
                      <rect x={xc} y={y(x.m)} width={w} height={y(0) - y(x.m)} rx="3" fill="var(--accent)" opacity={x.part ? 0.6 : 1} />
                      <text x={xc + w / 2} y={y(x.m) - 5} textAnchor="middle" className="val">{nf(Math.round(x.m / 60))}</text>
                      <text x={cx} y={H - 6} textAnchor="middle">{MON[+x.ym.slice(5, 7) - 1]} {x.ym.slice(0, 4)}{x.part ? '*' : ''}</text>
                    </g>
                  );
                })}
                {f3 && (() => {
                  const cx = left + mt.length * bw + bw / 2, fw0 = Math.min(56, bw * 0.5);
                  return (
                    <g {...tip(`Forecast · W${fw.next[0].w}–W${fw.next[2].w} (${dShort(fw.next[0].a)} – ${dShort(fw.next[2].b)})`, `Likely ${nf(t3.lo)}–${nf(t3.hi)} h for the team, from its last 8 full weeks. Not in any total.`, `${nf(t3.lo)}–${nf(t3.hi)} h`)}>
                      <line x1={cx - bw / 2} x2={cx - bw / 2} y1={top - 8} y2={H - bot} stroke="var(--fg2)" strokeDasharray="3 3" />
                      <rect x={cx - fw0 / 2} y={y(f3.mid)} width={fw0} height={y(0) - y(f3.mid)} rx="3" fill="url(#fcHatch)" stroke="var(--accent)" strokeDasharray="4 3" />
                      <line x1={cx} x2={cx} y1={y(f3.hi)} y2={y(f3.lo)} stroke="var(--fg)" strokeWidth="2" />
                      <line x1={cx - 6} x2={cx + 6} y1={y(f3.hi)} y2={y(f3.hi)} stroke="var(--fg)" strokeWidth="2" />
                      <line x1={cx - 6} x2={cx + 6} y1={y(f3.lo)} y2={y(f3.lo)} stroke="var(--fg)" strokeWidth="2" />
                      <text x={cx} y={y(f3.hi) - 6} textAnchor="middle" className="val">{nf(t3.lo)}–{nf(t3.hi)}</text>
                      <text x={cx} y={H - 6} textAnchor="middle">Next 3 weeks · forecast</text>
                    </g>
                  );
                })()}
              </svg>
            </figure>
          );
        })()}

        {fcOn && (
          <div className="fcnote" role="status">
            <b>Forecast on</b>
            <span>{fcMonths ? 'One column for' : 'Three columns for'} W{fw.next[0].w}–W{fw.next[2].w} ({dShort(fw.next[0].a)} – {dShort(fw.next[2].b)}) after the total, hatched: each person’s likely hours, from their last 8 full weeks (the middle 60% of their weeks). The team’s range comes from its own weekly totals. Leave and holidays are not known, so they would not lower a week.</span>
            <span className="fcno">Never added to a total, a scorecard’s logged hours or the export.</span>
            <button className="linkbtn" type="button" onClick={() => toggleFc(false)}>Turn off</button>
          </div>
        )}

        <div className="hkey">
          <span><span className="swatch" style={{ background: 'color-mix(in srgb,var(--warn) 14%,var(--panel))' }} />Unusually low: below 60% of this person’s usual {st.hcols} (adjusted for working days)</span>
          <span><span className="swatch" style={{ background: 'color-mix(in srgb,var(--warn) 30%,var(--panel))' }} />No hours logged</span>
          {st.hcols === 'week' && <span><b className="openmark">W44*</b> open week, can still change</span>}
          {fcOn && <span><span className="swatch fcsw" />Forecast, not in totals</span>}
        </div>

        <div className="scroll hscroll">
          {rows.length ? (
            <table className="sheet">
              <thead>
                {(st.hcols === 'week' || fcOn) && (
                  <tr>
                    <th />
                    {st.hcols === 'week'
                      ? groups.map((g) => <th key={g.ym} className="mhead mstart" colSpan={g.weeks.length}>{MONL[+g.ym.slice(5, 7) - 1]} {g.ym.slice(0, 4)}</th>)
                      : <th colSpan={cols.length} />}
                    <th />
                    {fcOn && <th className="mhead fc fstart" colSpan={fcCols.length}>Forecast · not in totals</th>}
                  </tr>
                )}
                <tr>
                  <SortTh k="name" label="Person" sort={st.sortH} onSort={(s) => set({ sortH: s })} />
                  {cols.map((c) => (
                    <th key={c.key} className={`wk${c.mstart ? ' mstart' : ''}`}>
                      <button className="mbtn" title={`Show all entries in ${c.label}`} onClick={() => showDrill({ pi: null, a: c.a, b: c.b, title: `Everyone shown · ${c.label}${c.sub ? ` (${c.sub})` : ''}` })}>
                        <span className={c.open ? 'openmark' : ''} style={{ whiteSpace: 'pre-line' }}>{c.short || c.label}</span>
                        {c.sub && <><br /><span style={{ fontWeight: 400 }}>{c.sub}</span></>}
                      </button>
                    </th>
                  ))}
                  <SortTh k="hours" label="Total" className="grand" sort={st.sortH} onSort={(s) => set({ sortH: s })} />
                  {fcOn && fcCols.map((c, k) => (
                    <th key={c.name} className={`wk fc${k ? '' : ' fstart'}`}>{c.n > 1 ? 'Next 3 weeks' : c.name}<br /><span style={{ fontWeight: 400 }}>{c.n > 1 ? `${c.name} · ` : ''}{fcSpan(c)}</span></th>
                  ))}
                </tr>
                {/* totals sit at the top, under the column titles: the first thing a reader looks for */}
                <tr className="totrow">
                  <td>Total</td>
                  {cols.map((c) => <td key={c.key} className={`n${c.open ? ' open' : ''}${c.mstart ? ' mstart' : ''}`}>{c.a > today ? '–' : fmtH(rows.reduce((a, x) => a + cell(x.p.i, c), 0))}</td>)}
                  <td className="n grand">{fmtH(grand)}</td>
                  {fcCells('Team', teamFc)}
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((x) => {
                  const pj = projects.get(x.p.i) || [];
                  const out = [
                    <tr className="person" key={x.p.i}>
                      <td><button className="pbtn" title={`Show all of ${x.p.name}’s entries in the period`} onClick={() => showDrill({ pi: x.p.i, a: rg.a, b: rg.b, title: `${x.p.name} · whole period` })}><Who p={x.p} /></button></td>
                      {cols.map((c) => numCell(cell(x.p.i, c), c, x.p))}
                      <td className="n grand">{fmtH(x.tot)}</td>
                      {fcCells(x.p.name, personFc(x.p))}
                    </tr>,
                  ];
                  if (pj.length > 1) pj.forEach((j) => out.push(
                    <tr className="proj" key={x.p.i + j}>
                      <td>{projLabel(j)}</td>
                      {cols.map((c) => numCell(cell(x.p.i, c, j), c, x.p, j))}
                      <td className="n grand">{fmtH(span(x.p.i, rg.a, rg.b, j))}</td>
                      {blankFc()}
                    </tr>,
                  ));
                  return out;
                })}
              </tbody>
            </table>
          ) : <div className="state">No hours logged by the selected people in this period.</div>}
        </div>

        {drill && <DrillPanel data={data} drill={drill} names={drill.pi !== null ? [drill.pi] : rows.map((x) => x.p.i)} fmtH={fmtH} onClose={() => setDrill(null)} />}

        <div className="foot"><b>Former members with time in the period are always included</b> (tagged “Former”), whatever “Show former members” says; otherwise the total would not match Tempo. Hours are summed in minutes, so every row and column adds up exactly to its total. Project lines appear when a person logged in more than one project.</div>
      </div>
    </section>
  );
}

function DrillPanel({ data, drill, names, fmtH, onClose }: { data: Data; drill: Drill; names: number[]; fmtH: (m: number) => string; onClose: () => void }) {
  const set = new Set(names), many = names.length > 1;
  const logs = logsIn(data.logs, drill.a, drill.b).filter((l) => set.has(l.p) && (!drill.proj || l.proj === drill.proj))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : data.people[x.p].name.localeCompare(data.people[y.p].name)));
  const tot = logs.reduce((a, l) => a + l.min, 0);
  return (
    <section className="hdrill" id="hDrill" aria-live="polite">
      <header><h3>{drill.title} · {fmtH(tot)} h · {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}</h3><button className="btn" onClick={onClose}>Close</button></header>
      <div className="dscroll">
        <table>
          <thead><tr><th>Date</th>{many && <th>Person</th>}<th>Jira issue</th><th>Summary</th><th>Project</th><th className="n">Hours</th><th>Description</th></tr></thead>
          <tbody>
            {logs.length ? logs.map((l, k) => (
              <tr key={k}>
                <td>{l.date} ({WD[DD(l.date).getUTCDay()]})</td>
                {many && <td>{data.people[l.p].name}</td>}
                <td>{l.key.startsWith('#') ? l.key : <a href={`${data.snap.jiraBase}/browse/${l.key}`} target="_blank" rel="noreferrer">{l.key}</a>}</td>
                <td>{data.snap.issues[l.key]?.[0]}</td>
                <td>{l.proj}</td>
                <td className="n">{fmtH(l.min)}</td>
                <td>{l.desc}</td>
              </tr>
            )) : <tr><td colSpan={many ? 7 : 6}>No entries.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={many ? 5 : 4}>Total</td><td className="n">{fmtH(tot)}</td><td /></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

