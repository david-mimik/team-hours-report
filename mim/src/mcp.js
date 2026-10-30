// This mim's tools as an MCP server (POST /mcp, JSON-RPC 2.0, plain JSON answers), registered in the mimOE MCP gateway
// as GATEWAY_SERVER_ID so Claude Code (through Muster) can call them, like Team Advisor's mims.
//   - server tools (datasets.js, teamtime.js): run here, their result goes back to Claude;
//   - the page's render tools (render-tools.js): calling one only acknowledges it; agui.js relays the call to the
//     page, whose handler adds the block.
const datasets = require('./datasets');
const { RENDER_TOOLS } = require('./render-tools');

function list() {
  return datasets.tools.map((t) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }))
    .concat(RENDER_TOOLS.map((t) => ({ name: t.name, description: `${t.description} The user sees it on the report canvas.`, inputSchema: t.inputSchema })));
}

// One JSON-RPC message -> its answer, or null for a notification.
async function handle(msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.id === undefined || msg.id === null) return null;
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'team-hours-report', version: '0.1.0' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: list() });
    case 'tools/call': {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      if (datasets.has(name)) {
        const text = await datasets.call(name, args);
        return reply({ content: [{ type: 'text', text }], isError: /^\{"error"/.test(text) });
      }
      if (RENDER_TOOLS.some((t) => t.name === name)) return reply({ content: [{ type: 'text', text: `${name}: added to the report.` }] });
      return reply({ content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
    }
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

module.exports = { handle };
