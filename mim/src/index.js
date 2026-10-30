// team-hours-report mim entry point. mimOE calls mimikModule.exports(context, req, res) for every request, in a fresh
// JavaScript context: nothing in memory survives between requests (datasets live in context.storage).
//
//   GET    /                 the Team Time report (team-time.html; web/dist uploaded by scripts/deploy.sh)
//   GET    /index.html       the CopilotKit report builder
//   GET    /:file            a file of the page
//   PUT    /ui/:file         upload a page file, body = { text } (Bearer WRITE_API_KEY when set)
//   POST   /agui             AG-UI agent endpoint (SSE)
//   POST   /mcp              this mim's tools as an MCP server, for Claude Code through the mimOE MCP gateway
//   GET    /healthcheck
//   GET    /datasets         list datasets
//   PUT    /datasets/:id     create or replace a dataset        (Bearer WRITE_API_KEY when set)
//   DELETE /datasets/:id     delete a dataset                   (Bearer WRITE_API_KEY when set)
//   GET    /team-time/data   Team Time snapshot (Tempo worklogs + Jira tickets), 404 before the first sync
//   POST   /team-time/sync   re-read Tempo and Jira into the snapshot (Bearer WRITE_API_KEY when set)
//
// The page is NOT bundled into this file: the mim's code is loaded for every request, and CopilotKit's page with
// its lazy chunks is several MB. Its files are text only (Vite inlines fonts into the CSS) and live in the mim's
// storage, one item per file, under the 'ui' tag. (context.storage.saveFile + response.writeMimeFile did not round-trip
// file contents on mimOE v3.30.84, so they are not used.)
const Router = require('router');
const agui = require('./agui');
const datasets = require('./datasets');
const teamtime = require('./teamtime');
const mcp = require('./mcp');

const app = Router();

const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const PAGE_FILE = /^[\w.-]+\.(html|js|css)$/;
const UI_KEY = (file) => `ui:${file}`;

// Header names in lowercase: the mimOE gateway only recognizes its own headers (content-type, transfer-encoding, ...)
// in lowercase; any other spelling is passed through as an extra header next to the gateway's defaults, and an SSE
// response then goes out buffered, with Content-Length. The gateway adds the CORS headers itself.
function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

function canWrite(req) {
  const key = global.context.env.WRITE_API_KEY;
  if (!key) return true;
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return auth === `Bearer ${key}`;
}

app.options('/*', (req, res) => {
  res.statusCode = 204;
  res.end();
});

function servePageFile(res, file) {
  const text = global.context.storage.getItem(UI_KEY(file));
  if (text === null || text === undefined) {
    return sendJson(res, 404, { code: 404, message: /\.html$/.test(file) ? 'Page not uploaded: run scripts/deploy.sh --ui' : 'Not Found' });
  }
  res.statusCode = 200;
  res.setHeader('content-type', MIME[file.split('.').pop()]);
  // The .html pages change on every deploy; the hashed chunks never do.
  res.setHeader('cache-control', /\.html$/.test(file) ? 'no-store' : 'public, max-age=31536000, immutable');
  return res.end(text);
}

app.get('/', (req, res) => servePageFile(res, 'team-time.html'));

app.get('/healthcheck', (req, res) => {
  sendJson(res, 200, { status: 'ok', info: global.context.info });
});

app.put('/ui/:file', (req, res) => {
  if (!canWrite(req)) return sendJson(res, 401, { code: 401, message: 'Unauthorized' });
  if (!PAGE_FILE.test(req.params.file)) return sendJson(res, 400, { code: 400, message: 'Not a page file name' });
  let text;
  try {
    text = JSON.parse(req.body || '{}').text;
  } catch (_e) {
    text = undefined;
  }
  if (typeof text !== 'string') return sendJson(res, 400, { code: 400, message: 'Body must be JSON { "text": "..." }' });
  global.context.storage.setItemWithTag(UI_KEY(req.params.file), text, 'ui');
  return sendJson(res, 200, { file: req.params.file, length: text.length });
});

app.post('/agui', async (req, res) => {
  let input;
  try {
    input = JSON.parse(req.body || '{}');
  } catch (_e) {
    sendJson(res, 400, { code: 400, message: 'Body is not valid JSON' });
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('transfer-encoding', 'chunked');
  await agui.run(input, (event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  res.end();
});

app.post('/mcp', async (req, res) => {
  let msg;
  try {
    msg = JSON.parse(req.body || '{}');
  } catch (_e) {
    return sendJson(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const out = await mcp.handle(msg);
  if (!out) {
    res.statusCode = 202;
    return res.end();
  }
  return sendJson(res, 200, out);
});

app.get('/datasets', (req, res) => {
  sendJson(res, 200, { data: datasets.list() });
});

app.put('/datasets/:id', (req, res) => {
  if (!canWrite(req)) return sendJson(res, 401, { code: 401, message: 'Unauthorized' });
  try {
    return sendJson(res, 200, datasets.put(req.params.id, JSON.parse(req.body || '{}')));
  } catch (e) {
    return sendJson(res, 400, { code: 400, message: e.message });
  }
});

app.delete('/datasets/:id', (req, res) => {
  if (!canWrite(req)) return sendJson(res, 401, { code: 401, message: 'Unauthorized' });
  datasets.remove(req.params.id);
  res.statusCode = 204;
  return res.end();
});

app.get('/team-time/data', (req, res) => {
  const text = teamtime.raw();
  if (!text) return sendJson(res, 404, { code: 404, message: 'No Team Time data yet: POST /team-time/sync' });
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  return res.end(text);
});

app.post('/team-time/sync', async (req, res) => {
  if (!canWrite(req)) return sendJson(res, 401, { code: 401, message: 'Unauthorized' });
  try {
    return sendJson(res, 200, await teamtime.sync());
  } catch (e) {
    console.error('team-time sync error:', e.message);
    return sendJson(res, 502, { code: 502, message: e.message });
  }
});

// Last: any other GET of a page file name.
app.get('/:file', (req, res, next) => (PAGE_FILE.test(req.params.file) ? servePageFile(res, req.params.file) : next()));

mimikModule.exports = (context, req, res) => {
  global.context = context;
  // The mim's base address without its final / (…/v1): send the browser to …/v1/ so the page's relative links resolve.
  if (!req.url || req.url.charAt(0) === '?') {
    res.statusCode = 301;
    res.setHeader('location', `${context.info.apiRoot}/${req.url || ''}`);
    res.end();
    return;
  }
  app(req, res, (e) => {
    sendJson(res, e ? 400 : 404, { code: e ? 400 : 404, message: e ? String(e.message || e) : 'Not Found' });
  });
};
