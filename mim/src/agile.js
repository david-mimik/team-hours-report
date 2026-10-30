// Agile metrics of the team's Jira board, as server tools for the agent. Numbers follow Jira's own reports, in hours:
// the board estimates in Original Time Estimate, so burndown, burnup and velocity are hours of estimate, and the
// Tempo snapshot (teamtime.js) adds the hours actually logged.
//   listSprints       the board's recent sprints
//   getSprintBurndown one sprint, day by day: ideal, remaining, scope, completed, logged (burndown and burnup)
//   getVelocity       committed vs completed per closed sprint (Jira's velocity chart), with hours logged
//   getFlowMetrics    cumulative flow per board column, cycle and lead time per resolved ticket, weekly throughput
//   getTicketStats    tickets grouped by status, assignee, priority, type or component (optionally split by another):
//                     count, done, completion %, estimate hours and Tempo hours logged
// Sources: Jira's sprint report APIs (/rest/greenhopper/1.0/rapid/charts/…, the ones its UI uses), the board
// configuration, and status-only changelogs (/rest/api/3/changelog/bulkfetch).
const atlassian = require('./atlassian');
const teamtime = require('./teamtime');

const DAY = 864e5;
const r1 = (x) => Math.round(x * 10) / 10;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dd = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const weekday = (ms) => { const w = new Date(ms).getUTCDay(); return w !== 0 && w !== 6; };
const shortName = (n) => String(n).replace(/^[A-Z][A-Z0-9]*-\d{4}-/, '');
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

async function context() {
  const s = atlassian.settings();
  const p = String(global.context.env.TEAM_PROJECTS || 'ZR').split(',')[0].trim();
  const bd = await atlassian.board(s, p);
  if (!bd) throw new Error(`Project ${p} has no scrum board`);
  return { s, p, bd };
}

// The board's own sprints (a board also lists sprints of other projects' boards; those are left out)
async function sprintList(c) {
  const all = await atlassian.sprints(c.s, c.p);
  const own = all.filter((x) => x.name.indexOf(`${c.p}-`) === 0);
  return own.length ? own : all;
}

function pickSprint(list, want) {
  const w = String(want || 'current').trim().toLowerCase();
  const closed = list.filter((x) => x.state === 'closed');
  if (w === 'current' || w === 'active') return list.find((x) => x.state === 'active') || closed[closed.length - 1];
  if (w === 'previous' || w === 'last' || w === 'last closed') return closed[closed.length - 1];
  return list.find((x) => String(x.id) === w || x.name.toLowerCase() === w || shortName(x.name).toLowerCase() === w);
}

// Tempo hours on these tickets (all tickets when keys is null) between two days, from the Team Time snapshot; the
// snapshot is synced first when the mim has none (after a redeploy), about 20 s.
async function loggedFn() {
  if (!teamtime.raw()) await teamtime.sync().catch(() => null);
  const text = teamtime.raw();
  if (!text) return null;
  const logs = JSON.parse(text).logs;
  return (keys, fromDay, toDay) => logs.reduce((a, r) => (r[0] >= fromDay && r[0] <= toDay && (!keys || keys[r[2]]) ? a + r[3] : a), 0) / 60;
}

// The latest sprints up to the active one, and the next one planned.
async function listSprints({ count }) {
  const c = await context();
  const list = await sprintList(c);
  const started = list.filter((x) => x.state !== 'future');
  const next = list.filter((x) => x.state === 'future').slice(0, 1);
  return {
    board: c.bd.name,
    sprints: started.slice(-(Number(count) || 12)).concat(next).map((x) => ({ id: x.id, name: x.name, short: shortName(x.name), start: x.start, end: x.end, state: x.state })),
  };
}

async function sprintBurndown({ sprint }) {
  const c = await context();
  const list = await sprintList(c);
  const sp = pickSprint(list, sprint);
  if (!sp) return { error: `No sprint "${sprint}". Recent sprints: ${list.slice(-8).map((x) => shortName(x.name)).join(', ')}` };
  const base = `/rest/greenhopper/1.0/rapid/charts`;
  const sc = await atlassian.jira(c.s, 'Jira burndown', `${base}/scopechangeburndownchart.json?rapidViewId=${c.bd.id}&sprintId=${sp.id}`);
  const rep = await atlassian.jira(c.s, 'Jira sprint report', `${base}/sprintreport?rapidViewId=${c.bd.id}&sprintId=${sp.id}`);

  // Replay Jira's scope changes: added/removed (added), estimate (statC, seconds), column done/not done (column).
  const events = [];
  Object.keys(sc.changes || {}).forEach((t) => sc.changes[t].forEach((ch) => events.push([Number(t), ch])));
  events.sort((a, b) => a[0] - b[0]);
  const st = {};
  const ever = {};
  let at = 0;
  const apply = (until) => {
    for (; at < events.length && events[at][0] <= until; at++) {
      const ch = events[at][1];
      const x = st[ch.key] || (st[ch.key] = { inSprint: false, est: 0, done: false, doneAtStart: false });
      if (ch.added !== undefined) x.inSprint = !!ch.added;
      if (ch.statC && ch.statC.newValue !== undefined) x.est = Number(ch.statC.newValue) || 0;
      if (ch.column) { x.done = !!ch.column.done; if (!x.done) x.doneAtStart = false; }
      if (x.inSprint) ever[ch.key] = true;
    }
  };
  const totals = () => {
    let scope = 0;
    let done = 0;
    Object.keys(st).forEach((k) => {
      const x = st[k];
      if (!x.inSprint || x.doneAtStart) return; // done before the sprint started: not part of it, as in Jira
      scope += x.est;
      if (x.done) done += x.est;
    });
    return { scope: scope / 3600, done: done / 3600 };
  };
  const start = sc.startTime;
  const stop = Math.min(sc.completeTime || Date.now(), Date.now());
  apply(start);
  Object.keys(st).forEach((k) => { if (st[k].inSprint && st[k].done) st[k].doneAtStart = true; });
  const committed = totals().scope;

  const first = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate());
  const lastPlanned = Math.max(sc.endTime, sc.completeTime || 0);
  const days = [];
  for (let d = first; d <= lastPlanned; d += DAY) days.push(d);
  const work = days.filter((d) => d <= sc.endTime && weekday(d)).length || 1;
  const logged = await loggedFn();
  const startDay = iso(start);
  let worked = 0;
  const point = (label, instant, idealLeft) => {
    const future = instant > stop;
    if (!future) apply(instant);
    const t = totals();
    return {
      day: label, ideal: r1(Math.max(0, idealLeft)),
      remaining: future ? null : r1(t.scope - t.done), completed: future ? null : r1(t.done), scope: future ? null : r1(t.scope),
      logged: future || !logged ? null : r1(logged(ever, startDay, iso(Math.min(instant, stop)))),
    };
  };
  const rows = [point(`${dd(start)} start`, start, committed)];
  days.forEach((d) => {
    if (d <= sc.endTime && weekday(d)) worked += 1;
    rows.push(point(dd(d), Math.min(d + DAY - 1, Math.max(stop, d)), committed * (1 - worked / work)));
  });
  const end = totals();
  const k = rep.contents || {};
  return {
    sprint: { name: sp.name, short: shortName(sp.name), start: sp.start, end: sp.end, state: sp.state },
    unit: 'hours of original estimate (the board’s estimation); logged = hours logged in Tempo on the sprint’s tickets',
    howToChart: 'Burndown: renderChart kind "burndown", xKey "day", series ["remaining","ideal"]. Burnup: kind "burnup", xKey "day", series ["completed","scope"] (add "logged" to compare effort).',
    rows,
    summary: {
      committedHours: r1(committed), finalScopeHours: r1(end.scope), scopeChangeHours: r1(end.scope - committed),
      completedHours: r1(end.done), remainingHours: r1(end.scope - end.done),
      completionPct: end.scope ? Math.round((1000 * end.done) / end.scope) / 10 : 0,
      loggedHours: logged ? r1(logged(ever, startDay, iso(stop))) : null,
      issuesCompleted: (k.completedIssues || []).length, issuesNotCompleted: (k.issuesNotCompletedInCurrentSprint || []).length,
      issuesRemovedFromSprint: (k.puntedIssues || []).length, issuesAddedAfterStart: Object.keys(k.issueKeysAddedDuringSprint || {}).length,
    },
  };
}

async function velocity({ sprints }) {
  const c = await context();
  const v = await atlassian.jira(c.s, 'Jira velocity', `/rest/greenhopper/1.0/rapid/charts/velocity.json?rapidViewId=${c.bd.id}`);
  const stats = v.velocityStatEntries || {};
  const list = (await sprintList(c)).filter((x) => x.state === 'closed' && stats[x.id]).slice(-(Number(sprints) || 6));
  const logged = await loggedFn();
  const rows = list.map((x) => ({
    sprint: shortName(x.name),
    committed: r1(((stats[x.id].estimated || {}).value || 0) / 3600),
    completed: r1(((stats[x.id].completed || {}).value || 0) / 3600),
    logged: logged ? r1(logged(null, x.start, x.end)) : null,
  }));
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    unit: 'hours of original estimate; logged = all hours the team logged in Tempo during the sprint',
    howToChart: 'renderChart kind "velocity", xKey "sprint", series ["committed","completed"], with a referenceLine at the average completed.',
    rows,
    summary: {
      sprints: rows.length, averageCompleted: rows.length ? r1(sum('completed') / rows.length) : 0, averageCommitted: rows.length ? r1(sum('committed') / rows.length) : 0,
      sayDoRatioPct: sum('committed') ? Math.round((1000 * sum('completed')) / sum('committed')) / 10 : null,
    },
  };
}

async function flowMetrics({ from, to }) {
  const c = await context();
  const today = iso(Date.now());
  const toDay = /^\d{4}-\d{2}-\d{2}$/.test(to || '') && to < today ? to : today;
  let fromDay = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : iso(Date.parse(toDay) - 29 * DAY);
  if (Date.parse(toDay) - Date.parse(fromDay) > 120 * DAY) fromDay = iso(Date.parse(toDay) - 120 * DAY);

  // board columns (status ids per column) and each status's category (new / indeterminate / done)
  const cfg = await atlassian.jira(c.s, 'Jira board configuration', `/rest/agile/1.0/board/${c.bd.id}/configuration`);
  const columns = cfg.columnConfig.columns.map((col) => ({ name: col.name, ids: col.statuses.map((x) => String(x.id)) })).filter((col) => col.ids.length);
  const colOf = {};
  columns.forEach((col, i) => col.ids.forEach((id) => { colOf[id] = i; }));
  const cat = {};
  (await atlassian.jira(c.s, 'Jira statuses', `/rest/api/3/project/${encodeURIComponent(c.p)}/statuses`) || [])
    .forEach((t) => t.statuses.forEach((x) => { cat[String(x.id)] = x.statusCategory.key; }));

  const issues = await atlassian.searchAll(c.s,
    `project = ${c.p} AND issuetype != Epic AND created <= "${toDay} 23:59" AND (resolution is EMPTY OR resolved >= "${fromDay}")`,
    ['status', 'created', 'resolutiondate', 'timeoriginalestimate']);
  const moves = {};
  const groups = chunks(issues.map((x) => x.id), 1000);
  for (let g = 0; g < groups.length; g++) {
    let token = null;
    do {
      const body = { issueIdsOrKeys: groups[g], fieldIds: ['status'], maxResults: 1000 };
      if (token) body.nextPageToken = token;
      const r = await atlassian.jira(c.s, 'Jira changelogs', '/rest/api/3/changelog/bulkfetch', body);
      (r.issueChangeLogs || []).forEach((l) => {
        const m = moves[l.issueId] || (moves[l.issueId] = []);
        (l.changeHistories || []).forEach((h) => (h.items || []).forEach((it) => { if (it.fieldId === 'status') m.push([Number(h.created), String(it.from), String(it.to)]); }));
      });
      token = r.nextPageToken || null;
    } while (token);
  }
  Object.keys(moves).forEach((k) => moves[k].sort((a, b) => a[0] - b[0]));

  // cumulative flow: tickets per board column at the end of each day (Done counts tickets resolved in the window)
  const series = columns.map((col) => col.name).reverse();
  const days = [];
  for (let d = Date.parse(fromDay); d <= Date.parse(toDay); d += DAY) days.push(d);
  const counts = days.map(() => columns.map(() => 0));
  issues.forEach((x) => {
    const created = Date.parse(String(x.fields.created).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    const m = moves[x.id] || [];
    let p = 0;
    let status = m.length ? m[0][1] : String(x.fields.status.id);
    days.forEach((d, i) => {
      const end = d + DAY - 1;
      if (created > end) return;
      while (p < m.length && m[p][0] <= end) { status = m[p][2]; p++; }
      if (colOf[status] !== undefined) counts[i][colOf[status]] += 1;
    });
  });
  const cfd = days.map((d, i) => {
    const row = { day: dd(d) };
    columns.forEach((col, j) => { row[col.name] = counts[i][j]; });
    return row;
  });

  // cycle time (first move into an in-progress status -> resolved) and lead time (created -> resolved)
  const cycle = [];
  const weeks = {};
  issues.forEach((x) => {
    const res = x.fields.resolutiondate && Date.parse(String(x.fields.resolutiondate).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    if (!res || iso(res) < fromDay || iso(res) > toDay) return;
    const created = Date.parse(String(x.fields.created).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    const started = (moves[x.id] || []).find((m) => cat[m[2]] === 'indeterminate');
    cycle.push({ key: x.key, done: iso(res), cycleDays: started ? r1((res - started[0]) / DAY) : null, leadDays: r1((res - created) / DAY), estimateHours: r1((x.fields.timeoriginalestimate || 0) / 3600) });
    const wd = new Date(res);
    const monday = Date.UTC(wd.getUTCFullYear(), wd.getUTCMonth(), wd.getUTCDate()) - ((wd.getUTCDay() + 6) % 7) * DAY;
    const w = weeks[monday] || (weeks[monday] = { week: `Wk ${dd(monday)}`, issues: 0, estimateHours: 0 });
    w.issues += 1;
    w.estimateHours = r1(w.estimateHours + (x.fields.timeoriginalestimate || 0) / 3600);
  });
  cycle.sort((a, b) => (a.done < b.done ? -1 : a.done > b.done ? 1 : 0));
  const ct = cycle.map((x) => x.cycleDays).filter((x) => x !== null).sort((a, b) => a - b);
  const lt = cycle.map((x) => x.leadDays).sort((a, b) => a - b);
  const avg = (l) => (l.length ? r1(l.reduce((a, b) => a + b, 0) / l.length) : null);
  const wip = issues.filter((x) => cat[String(x.fields.status.id)] === 'indeterminate').length;
  return {
    from: fromDay, to: toDay, columns: columns.map((col) => col.name),
    howToChart: 'Cumulative flow: kind "cfd", xKey "day", series = cfdSeries (Done first, at the bottom). Cycle time: kind "controlChart", xKey "done", series ["cycleDays"], referenceLines at the average and 85th percentile. Throughput: kind "bar", xKey "week", series ["issues"].',
    cfdSeries: series,
    cfd,
    cycleTimes: cycle.slice(-300),
    throughput: Object.keys(weeks).sort().map((k) => weeks[k]),
    summary: {
      resolved: cycle.length, workInProgressNow: wip,
      cycleDaysAverage: avg(ct), cycleDaysMedian: quantile(ct, 0.5), cycleDays85thPercentile: quantile(ct, 0.85),
      leadDaysAverage: avg(lt), leadDaysMedian: quantile(lt, 0.5),
      note: cycle.length > 300 ? 'cycleTimes lists the 300 most recent; the summary covers all' : undefined,
    },
  };
}

const GROUPS = {
  status: (f) => f.status.name,
  statusCategory: (f) => f.status.statusCategory.name,
  assignee: (f) => (f.assignee ? f.assignee.displayName : 'Unassigned'),
  priority: (f) => (f.priority ? f.priority.name : 'None'),
  issuetype: (f) => f.issuetype.name,
  component: (f) => ((f.components || [])[0] || { name: 'No component' }).name,
};

async function ticketStats({ scope, sprint, from, to, issueType, groupBy, splitBy }) {
  const c = await context();
  const today = iso(Date.now());
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const a = DATE.test(from || '') ? from : iso(Date.now() - 29 * DAY);
  const b = DATE.test(to || '') ? to : today;
  const by = GROUPS[groupBy] ? groupBy : 'status';
  const split = GROUPS[splitBy] && splitBy !== by ? splitBy : null;
  const sc = scope || (sprint ? 'sprint' : 'active');
  let jql = `project = ${c.p} AND issuetype != Epic`;
  if (issueType) jql += ` AND issuetype in (${String(issueType).split(',').map((t) => JSON.stringify(t.trim())).join(', ')})`;
  let window = [a, b];
  let label;
  if (sc === 'sprint') {
    const sp = pickSprint(await sprintList(c), sprint);
    if (!sp) return { error: `No sprint "${sprint}"` };
    jql += ` AND sprint = ${sp.id}`;
    window = [sp.start, sp.end < today ? sp.end : today];
    label = `sprint ${shortName(sp.name)} (${sp.start} to ${sp.end})`;
  } else if (sc === 'resolved') {
    jql += ` AND resolved >= "${a}" AND resolved <= "${b} 23:59"`;
    label = `resolved ${a} to ${b}`;
  } else if (sc === 'created') {
    jql += ` AND created >= "${a}" AND created <= "${b} 23:59"`;
    label = `created ${a} to ${b}`;
  } else if (sc === 'open') {
    jql += ' AND statusCategory != Done';
    label = 'open now';
  } else {
    jql += ` AND created <= "${b} 23:59" AND (resolution is EMPTY OR resolved >= "${a}")`;
    label = `open or resolved ${a} to ${b}`;
  }
  const issues = await atlassian.searchAll(c.s, jql, ['status', 'assignee', 'priority', 'issuetype', 'components', 'timeoriginalestimate']);
  const logged = await loggedFn();
  const groups = {};
  const splits = [];
  issues.forEach((x) => {
    const f = x.fields;
    const g = GROUPS[by](f);
    const row = groups[g] || (groups[g] = { [by]: g, tickets: 0, done: 0, estimateHours: 0, keys: {} });
    row.tickets += 1;
    if (f.status.statusCategory.key === 'done') row.done += 1;
    row.estimateHours += (f.timeoriginalestimate || 0) / 3600;
    row.keys[x.key] = true;
    if (split) {
      const v = GROUPS[split](f);
      if (splits.indexOf(v) < 0) splits.push(v);
      row[v] = (row[v] || 0) + 1;
    }
  });
  const rows = Object.keys(groups).map((g) => {
    const r = groups[g];
    const out = { [by]: g, tickets: r.tickets, done: r.done, completionPct: Math.round((1000 * r.done) / r.tickets) / 10, estimateHours: r1(r.estimateHours) };
    out.loggedHours = logged ? r1(logged(r.keys, window[0], window[1])) : null;
    splits.forEach((v) => { out[v] = r[v] || 0; });
    return out;
  }).sort((x, y) => y.tickets - x.tickets);
  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  return {
    scope: label, groupBy: by, splitBy: split, splitSeries: split ? splits : undefined,
    howToChart: `Share per ${by}: donut, xKey "${by}", series ["tickets"]. Planned vs done: bar or horizontalBar, series ["tickets","done"]. `
      + `Estimate vs logged: horizontalBar, series ["estimateHours","loggedHours"]. ${split ? `Split: percentBar, xKey "${by}", series = splitSeries.` : ''}`,
    rows,
    summary: {
      tickets: sum('tickets'), done: sum('done'), completionPct: rows.length ? Math.round((1000 * sum('done')) / sum('tickets')) / 10 : 0,
      estimateHours: r1(sum('estimateHours')), loggedHours: logged ? r1(sum('loggedHours')) : null,
    },
  };
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'listSprints',
      description: 'The team board’s recent sprints (id, name, short name like Q4-S5, dates, state: active/closed/future).',
      parameters: { type: 'object', properties: { count: { type: 'number', description: 'How many of the latest sprints, default 12' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSprintBurndown',
      description: 'One sprint day by day, in hours of estimate as Jira’s sprint report computes them: ideal, remaining, '
        + 'scope, completed and hours logged in Tempo. For burndown and burnup charts, scope change and sprint health.',
      parameters: {
        type: 'object',
        properties: { sprint: { type: 'string', description: '"current" (default), "previous", or a sprint name like Q4-S4 or ZR-2026-Q4-S4' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getVelocity',
      description: 'Velocity: hours of estimate committed vs completed per closed sprint (Jira’s velocity chart), with the '
        + 'hours the team logged in each sprint. For velocity, predictability (say/do) and capacity charts.',
      parameters: { type: 'object', properties: { sprints: { type: 'number', description: 'How many closed sprints, default 6 (Jira keeps about 7)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFlowMetrics',
      description: 'Flow between two dates (max 120 days, default the last 30): cumulative flow per board column per day, '
        + 'cycle time and lead time per resolved ticket, weekly throughput, work in progress. For CFD, control chart and throughput.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string', description: 'First day, YYYY-MM-DD' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD (default today)' } },
      },
    },
  },
];

tools.push({
  type: 'function',
  function: {
    name: 'getTicketStats',
    description: 'Jira tickets grouped by status, statusCategory, assignee, priority, issuetype or component (optionally split by '
      + 'a second one): tickets, done, completion %, estimate hours and Tempo hours logged per group. For tasks by status, '
      + 'tasks per person, planned vs closed, estimate vs logged per person, bugs by status and priority, features or bugs closed in a period.',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['sprint', 'resolved', 'created', 'open', 'active'], description: 'sprint: tickets in a sprint; resolved/created: in from–to; open: not done now; active (default): open or resolved in from–to' },
        sprint: { type: 'string', description: 'For scope sprint: "current", "previous" or a name like Q4-S4' },
        from: { type: 'string', description: 'YYYY-MM-DD (default 30 days ago)' },
        to: { type: 'string', description: 'YYYY-MM-DD (default today)' },
        issueType: { type: 'string', description: 'Only these issue types, comma separated, e.g. "Bug" or "Story,Task"' },
        groupBy: { type: 'string', enum: Object.keys(GROUPS), description: 'Rows per this field (default status)' },
        splitBy: { type: 'string', enum: Object.keys(GROUPS), description: 'Optional second field: one column per value (for percentBar / stackedBar)' },
      },
    },
  },
});

const handlers = { listSprints, getSprintBurndown: sprintBurndown, getVelocity: velocity, getFlowMetrics: flowMetrics, getTicketStats: ticketStats };

module.exports = { tools, handlers };
