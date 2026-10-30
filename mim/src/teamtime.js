// Team Time report data: Tempo worklogs + Jira ticket details, synced into the mim's storage and served to the page.
//   sync()   reads Tempo and Jira (a few hundred requests' worth of rows) and stores one compact snapshot
//   raw()    the stored snapshot as a JSON string (GET /team-time/data), or null before the first sync
//   tools    getTeamTime: totals by phase and person for a date range, for the chat agent
//
// Env: TEAM_PROJECTS (Jira project keys, default ZR; the first one's board gives the sprints),
//      TEAM_EXTRA_WORKLOGS ("BES:Name One|Name Two;OTHER:Name": other projects' worklogs, only by these people),
//      TEAM_HISTORY_MONTHS (default 24, so a 12-month period still has a previous period to compare with).
//
// Snapshot (v1): { v, asOf, from, to, jiraBase, phases, people: [[name, active]], sprints: [[name, start, end, state]],
//   issues: { KEY: [summary, phase, how] }, logs: [[date, person, KEY, minutes, description]] }
const atlassian = require('./atlassian');
const phases = require('./phases');

const TAG = 'teamtime';
const KEY = 'teamtime:snapshot';
const PART = 256 * 1024;

const uniq = (list) => list.filter((x, i, a) => a.indexOf(x) === i);
const iso = (d) => d.toISOString().slice(0, 10);

// Large values are kept in 256 KB items: KEY:0, KEY:1, ... and KEY:n with the count.
function putBig(key, str) {
  const store = global.context.storage;
  const n = Math.ceil(str.length / PART) || 1;
  const old = Number(store.getItem(`${key}:n`) || 0);
  for (let i = 0; i < n; i++) store.setItemWithTag(`${key}:${i}`, str.slice(i * PART, (i + 1) * PART), TAG);
  for (let i = n; i < old; i++) store.removeItem(`${key}:${i}`);
  store.setItemWithTag(`${key}:n`, String(n), TAG);
}

function getBig(key) {
  const store = global.context.storage;
  const n = Number(store.getItem(`${key}:n`) || 0);
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) {
    const p = store.getItem(`${key}:${i}`);
    if (p === null || p === undefined) return null;
    s += p;
  }
  return s;
}

// "BES:Name One|Name Two;OTHER:Name" -> [{ project: 'BES', people: ['Name One', 'Name Two'] }, ...]
function extraOf(v) {
  return String(v || '').split(';').map((x) => x.split(':'))
    .filter((x) => x[0] && x[0].trim() && x[1])
    .map((x) => ({ project: x[0].trim(), people: x[1].split('|').map((n) => n.trim()).filter(Boolean) }));
}

async function sync() {
  const s = atlassian.settings();
  const env = global.context.env;
  const projects = String(env.TEAM_PROJECTS || 'ZR').split(',').map((x) => x.trim()).filter(Boolean);
  const extra = extraOf(env.TEAM_EXTRA_WORKLOGS);
  const months = Number(env.TEAM_HISTORY_MONTHS) || 24;
  const now = new Date();
  const to = iso(now);
  const from = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)));

  // 1. worklogs: every one in the team's projects, and the listed people's in the extra projects
  let logs = [];
  const sources = projects.map((p) => ({ project: p, people: null })).concat(extra);
  for (let i = 0; i < sources.length; i++) {
    const p = await atlassian.project(s, sources[i].project);
    (await atlassian.worklogs(s, p.id, from, to)).forEach((w) => { w.only = sources[i].people; logs.push(w); });
  }
  const seen = {};
  logs = logs.filter((w) => (seen[w.tempoWorklogId] ? false : (seen[w.tempoWorklogId] = true)));

  // 2. who logged them (former members are inactive Jira users)
  const accounts = uniq(logs.map((w) => w.author && w.author.accountId).filter(Boolean));
  const who = await atlassian.users(s, accounts);
  logs = logs.filter((w) => {
    const u = who[w.author && w.author.accountId];
    return !w.only || (u && w.only.indexOf(u.name) >= 0);
  });

  // 3. the tickets and their phase; a ticket with no rule of its own takes its parent's
  const fields = ['summary', 'components', 'issuetype', 'labels', 'parent'];
  const issues = await atlassian.issuesById(s, uniq(logs.map((w) => String(w.issue && w.issue.id)).filter(Boolean)), fields);
  const byKey = {};
  const byId = {};
  issues.forEach((x) => { byKey[x.key] = x; byId[String(x.id)] = x; });
  const missingParents = uniq(issues.map((x) => x.fields.parent && x.fields.parent.key).filter((k) => k && !byKey[k]));
  for (let i = 0; i < missingParents.length; i += 100) {
    const batch = await atlassian.searchAll(s, `key in (${missingParents.slice(i, i + 100).join(',')})`, fields);
    batch.forEach((x) => { byKey[x.key] = x; });
  }
  const phaseOf = (x) => {
    const own = phases.ownRule(x.fields);
    if (own) return own;
    const parent = x.fields.parent && byKey[x.fields.parent.key];
    const up = parent && phases.ownRule(parent.fields);
    return up ? [up[0], `Parent ${parent.key}: ${up[1]}`] : [phases.UNCLASSIFIED, ''];
  };
  const out = {};
  issues.forEach((x) => {
    const ph = phaseOf(x);
    out[x.key] = [x.fields.summary || '', ph[0], ph[1]];
  });

  // 4. compact rows
  const people = [];
  const personIx = {};
  const rows = logs.map((w) => {
    const id = w.author && w.author.accountId;
    if (personIx[id] === undefined) {
      personIx[id] = people.length;
      people.push([who[id] ? who[id].name : `Unknown user ${String(id).slice(-6)}`, who[id] && !who[id].active ? 0 : 1]);
    }
    const it = byId[String(w.issue && w.issue.id)];
    const key = it ? it.key : `#${w.issue && w.issue.id}`;
    if (!it) out[key] = ['(ticket not visible in Jira)', phases.UNCLASSIFIED, ''];
    return [w.startDate, personIx[id], key, Math.round((w.timeSpentSeconds || 0) / 60), String(w.description || '').slice(0, 200)];
  }).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

  const sprints = (await atlassian.sprints(s, projects[0])).map((x) => [x.name, x.start, x.end, x.state]);
  const snapshot = {
    v: 1, asOf: new Date().toISOString(), from, to, jiraBase: s.jiraBase, projects: projects.concat(extra.map((x) => x.project)),
    phases: phases.PHASES, people, sprints, issues: out, logs: rows,
  };
  const text = JSON.stringify(snapshot);
  putBig(KEY, text);

  // what a reviewer of the phase mapping needs: components that decided nothing, and bugs filed under a component
  const minutesBy = {};
  const unmapped = {};
  let bugsByComponent = 0;
  rows.forEach((r) => {
    const x = byKey[r[2]];
    minutesBy[r[2]] = (minutesBy[r[2]] || 0) + r[3];
    if (!x) return;
    if (out[r[2]][1] === phases.UNCLASSIFIED) phases.unmappedComponents(x.fields).forEach((c) => { unmapped[c] = (unmapped[c] || 0) + r[3]; });
    if (x.fields.issuetype && x.fields.issuetype.name === 'Bug' && out[r[2]][1] !== 4) bugsByComponent += r[3];
  });
  const total = rows.reduce((a, r) => a + r[3], 0);
  const unclassified = rows.filter((r) => out[r[2]][1] === phases.UNCLASSIFIED).reduce((a, r) => a + r[3], 0);
  return {
    asOf: snapshot.asOf, from, to, worklogs: rows.length, tickets: Object.keys(out).length, people: people.length,
    sprints: sprints.length, bytes: text.length, hours: Math.round(total / 6) / 10, unclassifiedHours: Math.round(unclassified / 6) / 10,
    unmappedComponentHours: Object.keys(unmapped).map((c) => ({ component: c, hours: Math.round(unmapped[c] / 6) / 10 })),
    bugHoursFiledByComponent: Math.round(bugsByComponent / 6) / 10,
  };
}

function raw() {
  return getBig(KEY);
}

// --- Server-side tool for the chat agent ---

const tools = [{
  type: 'function',
  function: {
    name: 'getTeamTime',
    description: 'Hours the team logged in Tempo between two dates, split by SDLC phase and by person, with the tickets '
      + 'that have no phase. With groupBy it adds "series": one row per day, week, month, sprint or person, with the '
      + 'total and the hours of each phase (for stacked bars, trend lines and person × phase charts).',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD' },
        groupBy: { type: 'string', enum: ['day', 'week', 'month', 'sprint', 'person'], description: 'Optional: rows per day, ISO week, month, sprint or person' },
      },
      required: ['from', 'to'],
    },
  },
}];

const hours = (m) => Math.round(m / 6) / 10;

// Before the first sync (or after a redeploy, which empties the mim's storage) the tool syncs first, about 20 s.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dShort = (day) => `${MON[+day.slice(5, 7) - 1]} ${+day.slice(8, 10)}`;
const mondayOf = (day) => { const d = new Date(`${day}T00:00:00Z`); return iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5)); };

// The label of a log's row for groupBy; sprints own the days from their start to the next sprint's start.
function grouper(d, groupBy) {
  if (groupBy === 'day') return (r) => dShort(r[0]);
  if (groupBy === 'week') return (r) => `Wk ${dShort(mondayOf(r[0]))}`;
  if (groupBy === 'month') return (r) => `${MON[+r[0].slice(5, 7) - 1]} ${r[0].slice(0, 4)}`;
  if (groupBy === 'person') return (r) => d.people[r[1]][0];
  if (groupBy === 'sprint') {
    const sp = d.sprints.filter((x) => x[0].indexOf(`${d.projects[0]}-`) === 0);
    return (r) => {
      let label = null;
      sp.forEach((x, i) => { if (r[0] >= x[1] && (i + 1 === sp.length ? r[0] <= x[2] : r[0] < sp[i + 1][1])) label = x[0].replace(/^[A-Z][A-Z0-9]*-\d{4}-/, ''); });
      return label || 'Outside sprints';
    };
  }
  return null;
}

async function teamTime({ from, to, groupBy }) {
  if (!raw()) await sync();
  const text = raw();
  if (!text) return { error: 'No Team Time data: the sync from Tempo and Jira stored nothing' };
  const d = JSON.parse(text);
  const byPhase = d.phases.map(() => 0);
  const byPerson = {};
  const unclassified = {};
  const group = grouper(d, groupBy);
  const series = {};
  const order = [];
  let total = 0;
  d.logs.forEach((r) => {
    if (r[0] < from || r[0] > to) return;
    const it = d.issues[r[2]];
    total += r[3];
    if (group) {
      const g = group(r);
      if (!series[g]) { series[g] = d.phases.map(() => 0); order.push(g); }
      series[g][it[1]] += r[3];
    }
    byPhase[it[1]] += r[3];
    const name = d.people[r[1]][0];
    byPerson[name] = (byPerson[name] || 0) + r[3];
    if (it[1] === d.phases.length - 1) unclassified[r[2]] = (unclassified[r[2]] || 0) + r[3];
  });
  // capacity estimate for a gauge: 8 h per working day for each person who logged time (no leave or part time known)
  const until = to < iso(new Date()) ? to : iso(new Date());
  let workingDays = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${until}T00:00:00Z`); t += 864e5) { const w = new Date(t).getUTCDay(); if (w && w !== 6) workingDays += 1; }
  const people = Object.keys(byPerson).length;
  return {
    from, to, dataAsOf: d.asOf, totalHours: hours(total),
    capacity: {
      workingDays, peopleWhoLogged: people, capacityHoursEstimate: people * 8 * workingDays,
      utilizationPct: people && workingDays ? Math.round((1000 * total) / 60 / (people * 8 * workingDays)) / 10 : null,
      note: '8 h per working day for each person who logged time; leave and part-time are not known',
    },
    byPhase: d.phases.map((p, i) => ({ phase: p, hours: hours(byPhase[i]), share: total ? Math.round((1000 * byPhase[i]) / total) / 10 : 0 })),
    byPerson: Object.keys(byPerson).sort((a, b) => byPerson[b] - byPerson[a]).map((n) => ({ person: n, hours: hours(byPerson[n]) })),
    series: group ? (groupBy === 'person' ? order.sort((a, b) => series[b].reduce((x, y) => x + y, 0) - series[a].reduce((x, y) => x + y, 0)) : order).map((g) => {
      const row = { [groupBy]: g, total: hours(series[g].reduce((x, y) => x + y, 0)) };
      d.phases.forEach((p, i) => { row[p] = hours(series[g][i]); });
      return row;
    }) : undefined,
    topUnclassifiedTickets: Object.keys(unclassified).sort((a, b) => unclassified[b] - unclassified[a]).slice(0, 10)
      .map((k) => ({ ticket: k, summary: d.issues[k][0], hours: hours(unclassified[k]) })),
  };
}

const handlers = { getTeamTime: teamTime };

module.exports = { sync, raw, tools, handlers };
