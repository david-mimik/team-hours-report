// Lets Claude Code (through Muster, as in Team Advisor) use this mim's tools: registers the mim's MCP endpoint in the
// mimOE MCP gateway and grants that server to Muster's gateway client key. Gateway API only (never edits
// mcp-gateway.json, only reads it for Muster's key). Idempotent: run it after every deploy (it restarts the server so the
// gateway reads tools/list again).
//   node scripts/claude-setup.cjs [--remove]
// Env: MIMOE_URL (default http://localhost:8083), GATEWAY_SERVER_ID (default team-hours-report).
// The admin key is MCP_GATEWAY_API_KEY from ~/.mimoe/mimoe-api-key.env. Keys are never printed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const NODE = process.env.MIMOE_URL || 'http://localhost:8083';
const ID = process.env.GATEWAY_SERVER_ID || 'team-hours-report';
const ENDPOINT = '/api/team-hours-report/v1/mcp';

function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

// Muster's registration in the gateway: its env holds MUSTER_API_KEY (the /agent/v1 bearer) and MUSTER_GATEWAY_KEY.
function musterEnv() {
  const file = path.join(os.homedir(), '.mimoe', 'mcp-gateway.json');
  if (!fs.existsSync(file)) return {};
  const servers = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers || {};
  return (servers.muster && servers.muster.env) || {};
}

async function api(method, p, admin, body) {
  const r = await fetch(`${NODE}/mcp/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = null; }
  return { status: r.status, json };
}

const listOf = (j, k) => (Array.isArray(j) ? j : (j && (j.data || j[k])) || []);

(async () => {
  const admin = envFile(path.join(os.homedir(), '.mimoe', 'mimoe-api-key.env')).MCP_GATEWAY_API_KEY;
  if (!admin) throw new Error('No MCP_GATEWAY_API_KEY in ~/.mimoe/mimoe-api-key.env');
  const muster = musterEnv();
  const grant = muster.MUSTER_GATEWAY_KEY;
  const keys = listOf((await api('GET', '/keys', admin)).json, 'keys');
  const mine = grant && keys.find((k) => (k.id || k.key) === grant);

  if (process.argv.includes('--remove')) {
    if (mine && (mine.servers || []).includes(ID)) await api('PUT', `/keys/${encodeURIComponent(grant)}`, admin, { description: mine.description, servers: mine.servers.filter((s) => s !== ID) });
    await api('DELETE', `/servers/${ID}`, admin);
    console.log(`claude: removed MCP server ${ID} and its grant to Muster`);
    return;
  }

  const servers = listOf((await api('GET', '/servers', admin)).json, 'servers');
  if (servers.some((s) => (s.id || s.name) === ID)) {
    await api('POST', `/servers/${ID}/restart`, admin);
    console.log(`claude: MCP server ${ID} restarted`);
  } else {
    const r = await api('POST', '/servers', admin, {
      id: ID, transport: 'http', endpoint: ENDPOINT, namespace: true, auto_start: true, restart_on_crash: true, max_execution_time_sec: 60, max_retries: 3,
    });
    if (r.status >= 300) throw new Error(`Could not register MCP server ${ID} (HTTP ${r.status})`);
    console.log(`claude: MCP server ${ID} registered (${ENDPOINT})`);
  }

  if (!grant) {
    console.log('claude: Muster is not registered in the gateway with a MUSTER_GATEWAY_KEY; install it with Team Advisor Setup (Claude Code engine)');
  } else if (!mine) {
    console.log("claude: Muster's gateway key is not in GET /mcp/v1/keys; grant the server by hand");
  } else if ((mine.servers || []).includes(ID)) {
    console.log(`claude: Muster's key already has ${ID}`);
  } else {
    const r = await api('PUT', `/keys/${encodeURIComponent(grant)}`, admin, { description: mine.description, servers: (mine.servers || []).concat(ID) });
    if (r.status >= 300) throw new Error(`Could not grant ${ID} to Muster's key (HTTP ${r.status})`);
    console.log(`claude: granted ${ID} to Muster's gateway key`);
  }
})().catch((e) => { console.error(`claude: ${e.message}`); process.exit(1); });
