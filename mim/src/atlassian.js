// Read-only clients for Jira Cloud and Tempo Cloud, over requestAction (src/http.js).
// Settings come from the mim's env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, TEMPO_BASE_URL, TEMPO_API_TOKEN.
// Tokens never leave the mim: the page only gets rows.
const { requestAction } = require('./http');

// UTF-8 base64 for the Basic auth header (no Buffer or btoa in the mimOE runtime)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(s) {
  const b = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else b.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

const chunks = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

function settings() {
  const e = global.context.env;
  const s = {
    jiraBase: (e.JIRA_BASE_URL || '').replace(/\/$/, ''),
    jiraEmail: e.JIRA_EMAIL || '',
    jiraToken: e.JIRA_API_TOKEN || '',
    tempoBase: (e.TEMPO_BASE_URL || 'https://api.tempo.io/4').replace(/\/$/, ''),
    tempoToken: e.TEMPO_API_TOKEN || '',
  };
  if (!s.jiraBase || !s.jiraEmail || !s.jiraToken) throw new Error('Jira is not configured: set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN');
  if (!s.tempoToken) throw new Error('Tempo is not configured: set TEMPO_API_TOKEN');
  return s;
}

// One request, JSON back. A refused connection arrives on success with status < 0; a non-2xx arrives on error as
// "<code> - <body>", or on success with its status.
async function getJson(label, url, authorization, body) {
  const res = await requestAction({
    url,
    method: body ? 'POST' : 'GET',
    headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    authorization,
    jsonBody: body,
    socketTimeout: 60000,
  }).catch((e) => {
    throw new Error(`${label} failed: ${String(e.message).slice(0, 300)}`);
  });
  if (typeof res.status === 'number' && (res.status < 0 || res.status >= 300)) {
    throw new Error(`${label} failed (${res.status}): ${String(res.data || '').slice(0, 300)}`);
  }
  return res.data ? JSON.parse(res.data) : null;
}

const jira = (s, label, path, body) => getJson(label, s.jiraBase + path, `Basic ${base64(`${s.jiraEmail}:${s.jiraToken}`)}`, body);
const tempo = (s, label, url) => getJson(label, url, `Bearer ${s.tempoToken}`);

// Every page of POST /rest/api/3/search/jql (token paging).
async function searchAll(s, jql, fields) {
  let out = [];
  let token = null;
  do {
    const body = { jql, fields, maxResults: 100 };
    if (token) body.nextPageToken = token;
    const r = await jira(s, 'Jira search', '/rest/api/3/search/jql', body);
    out = out.concat(r.issues || []);
    token = r.isLast === false || r.nextPageToken ? r.nextPageToken : null;
  } while (token);
  return out;
}

// Issues by id, 100 per search.
async function issuesById(s, ids, fields) {
  let out = [];
  const groups = chunks(ids, 100);
  for (let i = 0; i < groups.length; i++) out = out.concat(await searchAll(s, `id in (${groups[i].join(',')})`, fields));
  return out;
}

// accountId -> { name, active }
async function users(s, accountIds) {
  const out = {};
  const groups = chunks(accountIds, 50);
  for (let i = 0; i < groups.length; i++) {
    const q = groups[i].map((a) => `accountId=${encodeURIComponent(a)}`).join('&');
    const r = await jira(s, 'Jira users', `/rest/api/3/user/bulk?maxResults=50&${q}`);
    (r.values || []).forEach((u) => { out[u.accountId] = { name: u.displayName, active: u.active !== false }; });
  }
  return out;
}

const project = (s, key) => jira(s, 'Jira project', `/rest/api/3/project/${encodeURIComponent(key)}`);

// The project's scrum board: { id, name }, or null.
async function board(s, projectKey) {
  const b = await jira(s, 'Jira boards', `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum`);
  return (b.values || [])[0] || null;
}

// The sprints of the project's scrum board that the board owns, oldest first: [{ id, name, start, end, state }].
async function sprints(s, projectKey) {
  const bd = await board(s, projectKey);
  if (!bd) return [];
  let all = [];
  for (let at = 0; ; at += 50) {
    const r = await jira(s, 'Jira sprints', `/rest/agile/1.0/board/${bd.id}/sprint?maxResults=50&startAt=${at}`);
    all = all.concat(r.values || []);
    if (r.isLast !== false || !(r.values || []).length) break;
  }
  return all
    .filter((x) => x.startDate && x.endDate && (!x.originBoardId || x.originBoardId === bd.id))
    .map((x) => ({ id: x.id, name: x.name, start: x.startDate.slice(0, 10), end: x.endDate.slice(0, 10), state: x.state }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

// Every Tempo worklog of a project between two dates (YYYY-MM-DD), credited to who logged it.
async function worklogs(s, projectId, from, to) {
  let url = `${s.tempoBase}/worklogs/project/${projectId}?from=${from}&to=${to}&limit=1000`;
  let out = [];
  while (url) {
    const r = await tempo(s, 'Tempo worklogs', url);
    out = out.concat(r.results || []);
    url = (r.metadata && r.metadata.next) || null;
  }
  return out;
}

module.exports = { settings, jira, searchAll, issuesById, users, project, board, sprints, worklogs };
