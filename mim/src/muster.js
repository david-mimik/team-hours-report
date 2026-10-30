// Claude Code through Muster, as Team Advisor does it (team-advisor/muster): Muster runs Claude Code sessions on the
// developer's own Claude login and speaks the mimOE harness agent API at /agent/v1:
//   POST /agent/v1/mcp  tools/call chat {sessionId, content, model?} | resume {toolCallId, decision}
// answered as SSE: notifications/message events (text, tool_start, tool_result, response_finish), then one JSON-RPC
// result; a result with _meta.interrupt (tool_approval) waits for `resume`.
// Claude gets this mim's tools from the mimOE MCP gateway (server GATEWAY_SERVER_ID, granted to Muster's gateway key by
// scripts/claude-setup.cjs), named mcp__mimoe__<server>__<tool>.
//
// The answer is read whole, not streamed: in stream mode a chunk that splits a multi-byte character reaches Duktape as
// a Symbol (found in zoara-executive-pulse), and the chat's text is not ASCII.
const { requestAction } = require('./http');

const MAX_APPROVALS = 20;

function settings() {
  const e = global.context.env;
  return {
    url: `${(e.MUSTER_URL || 'http://127.0.0.1:5191').replace(/\/$/, '')}/agent/v1/mcp`,
    key: e.MUSTER_API_KEY || '',
    model: e.CLAUDE_MODEL || '',
    prefix: `mcp__mimoe__${e.GATEWAY_SERVER_ID || 'team-hours-report'}__`,
  };
}

let rpcId = 0;
async function call(s, tool, args) {
  const res = await requestAction({
    url: s.url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    authorization: s.key ? `Bearer ${s.key}` : undefined,
    jsonBody: { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: args } },
    socketTimeout: 280000,
  }).catch((e) => {
    throw new Error(`Muster (Claude Code) did not answer: ${String(e.message).slice(0, 200)}. Is it running on ${s.url}?`);
  });
  if (typeof res.status === 'number' && (res.status < 0 || res.status >= 300)) {
    throw new Error(`Muster answered ${res.status}: ${String(res.data || '').slice(0, 200)}`);
  }
  const notes = [];
  let result = null;
  String(res.data || '').split(/\r?\n/).forEach((line) => {
    if (line.indexOf('data:') !== 0) return;
    let m;
    try {
      m = JSON.parse(line.slice(5).trim());
    } catch (_e) {
      return;
    }
    if (m.method === 'notifications/message') notes.push(m.params.data);
    else if (m.result || m.error) result = m.result || { isError: true, content: [{ type: 'text', text: m.error.message }] };
  });
  return { notes, result: result || { isError: true, content: [{ type: 'text', text: 'Muster ended the turn without a result' }] } };
}

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.map((c) => (c && c.type === 'text' ? c.text : '')).join('') : JSON.stringify(content || ''));

// One user turn. Returns the turn as ordered steps: { text } | { tool, args, id, result? } (tool = name without the
// gateway prefix; only this mim's tools are kept). This mim's tools are approved on Claude's behalf; any other tool is
// refused, so the session never waits on an approval nobody can give.
async function turn(sessionId, content) {
  const s = settings();
  const steps = [];
  const byId = {};
  let text = '';
  const flush = () => {
    if (text.trim()) steps.push({ text: text.trim() });
    text = '';
  };
  const args = { sessionId, content };
  if (s.model) args.model = s.model;
  let r = await call(s, 'chat', args);
  for (let i = 0; ; i++) {
    r.notes.forEach((n) => {
      if (n.type === 'text') text += n.delta || '';
      else if (n.type === 'tool_start' && String(n.name).indexOf(s.prefix) === 0) {
        flush();
        const step = { tool: n.name.slice(s.prefix.length), args: n.args || {}, id: String(n.toolCallId) };
        byId[step.id] = step;
        steps.push(step);
      } else if (n.type === 'tool_result' && byId[String(n.toolCallId)]) {
        byId[String(n.toolCallId)].result = textOf(n.content);
      }
    });
    const ask = r.result._meta && r.result._meta.interrupt;
    if (!ask || i >= MAX_APPROVALS) break;
    const ours = String(ask.toolName || ask.toolCallName || '').indexOf(s.prefix) === 0;
    r = await call(s, 'resume', { toolCallId: ask.toolCallId, decision: ours ? 'yes' : 'no' });
  }
  flush();
  if (r.result.isError) steps.push({ error: textOf(r.result.content) || 'Claude Code stopped with an error' });
  return steps;
}

module.exports = { turn };
