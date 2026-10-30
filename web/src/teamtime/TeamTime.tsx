// Team Time page: how the team spends its time across the SDLC (hours from Tempo, ticket details from Jira, read-only).
// Data comes from the mim (GET team-time/data); "Sync" asks the mim to re-read Tempo and Jira (POST team-time/sync).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dd, load, presets, todayIso, type Data } from './model';
import { fromHash, rangeOf, toHash, type State } from './state';
import { Hours } from './Hours';
import { TimeByPhase } from './TimeByPhase';
import { tip, toast, Tooltip } from './ui';

const mimBase = new URL(import.meta.env.VITE_MIM_BASE ?? './', window.location.href);

type Load = { status: 'loading' } | { status: 'empty' } | { status: 'error'; message: string } | { status: 'ready'; data: Data };

async function fetchData(): Promise<Load> {
  const r = await fetch(new URL('team-time/data', mimBase));
  if (r.status === 404) return { status: 'empty' };
  if (!r.ok) return { status: 'error', message: `Could not read the data (HTTP ${r.status})` };
  return { status: 'ready', data: load(await r.json()) };
}

function useSync(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(new URL('team-time/sync', mimBase), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || `HTTP ${r.status}`);
      toast(`Synced ${body.worklogs.toLocaleString('en-US')} worklogs on ${body.tickets.toLocaleString('en-US')} tickets`);
      onDone();
    } catch (e) {
      toast(`Sync failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [onDone]);
  return { busy, run };
}

function PeoplePicker({ data, st, set }: { data: Data; st: State; set: (p: Partial<State>) => void }) {
  const avail = useMemo(() => data.people.filter((p) => st.former || !p.former).sort((a, b) => a.name.localeCompare(b.name)), [data, st.former]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const chosen = st.people ? avail.filter((p) => st.people!.includes(p.name)) : avail;
  const toggleOpen = () => { setDraft(new Set(chosen.map((p) => p.name))); setOpen(!open); };
  const apply = () => { set({ people: avail.every((p) => draft.has(p.name)) ? null : [...draft] }); setOpen(false); };
  const flip = (n: string) => { const d = new Set(draft); d.has(n) ? d.delete(n) : d.add(n); setDraft(d); };
  return (
    <div className="grp ppl" ref={ref}>
      <span className="lbl">People</span>
      <button className="btn" aria-expanded={open} onClick={toggleOpen}>
        <span>{chosen.length === avail.length ? `All (${avail.length})` : chosen.length === 1 ? chosen[0].name : `${chosen.length} people`}</span><span>▾</span>
      </button>
      {open && (
        <div className="drop" role="dialog" aria-label="Choose people">
          <input type="search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <label><input type="checkbox" checked={avail.every((p) => draft.has(p.name))} onChange={(e) => setDraft(new Set(e.target.checked ? avail.map((p) => p.name) : []))} /> <b>(Select all)</b></label>
          <div className="list">
            {avail.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => (
              <label key={p.i}><input type="checkbox" checked={draft.has(p.name)} onChange={() => flip(p.name)} /> {p.name}{p.former && <span className="tag">Former</span>}</label>
            ))}
          </div>
          <div className="row"><button className="btn" onClick={() => setDraft(new Set())}>Clear</button><button className="btn primary" onClick={apply}>OK</button></div>
        </div>
      )}
    </div>
  );
}

export function TeamTime() {
  const today = useMemo(todayIso, []);
  const [state, setState] = useState<Load>({ status: 'loading' });
  const [st, setSt] = useState<State>(() => fromHash(location.hash, today));
  const set = useCallback((p: Partial<State>) => setSt((s) => ({ ...s, ...p })), []);
  const reload = useCallback(() => { fetchData().then(setState, (e) => setState({ status: 'error', message: e.message })); }, []);
  const sync = useSync(reload);
  useEffect(reload, [reload]);
  useEffect(() => { history.replaceState(null, '', toHash(st)); }, [st]);

  const theme = () => {
    const r = document.documentElement, dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    r.dataset.theme = dark ? 'light' : 'dark';
  };
  const copyLink = () => (navigator.clipboard ? navigator.clipboard.writeText(location.href) : Promise.reject()).then(() => toast('Link copied: it opens this exact view'), () => toast('Link ready in the address bar'));

  const head = (
    <header className="top">
      <div>
        <h1>Team Time</h1>
        <div className="sub">How the team spends its time across the software development lifecycle · hours from Tempo, ticket details from Jira (read-only)</div>
        {state.status === 'ready' && <div className="asof">Data from Tempo and Jira ({state.data.snap.projects.join(', ')}), synced {new Date(state.data.snap.asOf).toLocaleString()} · read-only</div>}
      </div>
      <div className="grp noprint">
        <a className="btn" href="index.html">← Report builder</a>
        <button className="btn" onClick={sync.run} disabled={sync.busy}>{sync.busy ? 'Syncing… (about 30 s)' : '↻ Sync from Tempo'}</button>
        <button className="btn" onClick={copyLink}>🔗 Copy link</button>
        <button className="btn" onClick={theme}>◐ Theme</button>
      </div>
    </header>
  );

  if (state.status !== 'ready') {
    return (
      <div className="wrap">
        {head}
        <div className="panel state">
          {state.status === 'loading' && 'Loading…'}
          {state.status === 'error' && <span className="err">{state.message}</span>}
          {state.status === 'empty' && (
            <>
              <div>No data yet. The first sync reads every worklog of the last two years from Tempo, and their tickets from Jira.</div>
              <button className="btn primary" onClick={sync.run} disabled={sync.busy}>{sync.busy ? 'Syncing… (about 30 s)' : 'Sync now'}</button>
            </>
          )}
        </div>
        <Tooltip /><div className="toast" id="toast" role="status" />
      </div>
    );
  }

  const data = state.data;
  const rg = rangeOf(st, data, today);
  const opts = presets(data, today);
  // the same rule as Hours: the people selected, and former members when they logged time (views filter by time), so
  // the totals of both views agree to the minute
  const people = data.people.filter((p) => !st.people || st.people.includes(p.name));

  return (
    <div className="wrap">
      {head}
      <div className="panel bar" role="region" aria-label="Filters">
        <div className="grp">
          <span className="lbl">Period</span>
          <select aria-label="Period" value={st.period === 'month' || st.period === 'custom' ? st.period : rg.p} onChange={(e) => set({ period: e.target.value })}>
            {opts.filter((o) => /^month|this/.test(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="month">A specific month…</option>
            <option disabled>──────────</option>
            {opts.filter((o) => !/^month|this/.test(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="custom">Custom range…</option>
          </select>
          {st.period === 'month' && <input type="month" aria-label="Month" value={st.ym} min={data.snap.from.slice(0, 7)} max={today.slice(0, 7)} onChange={(e) => e.target.value && set({ ym: e.target.value })} />}
          {st.period === 'custom' && (
            <>
              <input type="date" aria-label="From" value={st.from} min={data.snap.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
              <span className="lbl">to</span>
              <input type="date" aria-label="To" value={st.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            </>
          )}
        </div>
        <PeoplePicker data={data} st={st} set={set} />
        <div className="grp"><label className="lbl" {...tip('Compare to previous period', 'Every view shows each figure next to the same number of days just before the period.')}><input type="checkbox" checked={st.cmp} onChange={(e) => set({ cmp: e.target.checked })} /> Compare to previous period</label></div>
        <div className="grp"><label className="lbl"><input type="checkbox" checked={st.former} onChange={(e) => set({ former: e.target.checked })} /> Show former members</label></div>
      </div>

      <div className="privacy">
        {st.view === 'hours'
          ? <><span className="pill">🔒 Hours · per-person hours for closing a period</span><span>Former members with time in the period are always included, so totals match Tempo.</span></>
          : <><span className="pill">🔒 Per-person detail · visible to delivery leads</span><label className="lbl"><input type="checkbox" checked={st.teamOnly} onChange={(e) => set({ teamOnly: e.target.checked })} /> Show team totals only</label><span>Hours describe workload and plans, not performance.</span></>}
        <span className="cmpnote">· Period {dd(rg.a)} – {dd(rg.b)}, {rg.b.slice(0, 4)} applies to every view</span>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={st.view === 'hours'} onClick={() => set({ view: 'hours' })}>Hours</button>
        <button role="tab" aria-selected={st.view === 'time'} onClick={() => set({ view: 'time' })}>Time by phase</button>
      </div>

      {st.view === 'time'
        ? <TimeByPhase data={data} rg={rg} today={today} people={people} st={st} set={set} />
        : <Hours data={data} rg={rg} today={today} st={st} set={set} />}

      <Tooltip /><div className="toast" id="toast" role="status" />
    </div>
  );
}
