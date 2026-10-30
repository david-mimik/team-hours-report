// AG-UI agent: takes a RunAgentInput (https://docs.ag-ui.com) and emits AG-UI events.
//
// Two kinds of tools reach the model:
// - server tools (datasets.js), run here in the mim, results streamed back as TOOL_CALL_RESULT;
// - frontend tools (input.tools), registered by CopilotKit's useFrontendTool in the browser. When the model calls one,
//   the run ends; CopilotKit runs the tool, renders its UI and starts a new run with the result (followUp).
//
// Two engines (CHAT_ENGINE):
// - claude (default): Claude Code through Muster, as Team Advisor does it (muster.js). Claude calls this mim's tools
//   over the MCP gateway (mcp.js) and runs its whole turn; its render-tool calls are relayed here as frontend tool calls
//   (no result, so the page runs them), and CopilotKit's follow-up run is answered with nothing.
// - local: the node's local LLM (llm.js) with the loop below.
const llm = require('./llm');
const datasets = require('./datasets');
const muster = require('./muster');
const { systemPrompt, claudePreamble } = require('./instructions');

const MAX_STEPS = 6;

let seq = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return '';
}

// Qwen3 and other reasoning models may return their thinking inline.
const cleanText = (text) => (text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

// AG-UI messages -> OpenAI chat messages. Activity and reasoning messages are UI-only and are dropped.
function toOpenAiMessages(messages) {
  const out = [];
  (messages || []).forEach((m) => {
    if (m.role === 'user' || m.role === 'system' || m.role === 'developer') {
      out.push({ role: m.role === 'developer' ? 'system' : m.role, content: textOf(m.content) });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: textOf(m.content) };
      if (m.toolCalls && m.toolCalls.length) msg.tool_calls = m.toolCalls;
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: textOf(m.content) });
    }
  });
  return out;
}

const toOpenAiTool = (t) => ({
  type: 'function',
  function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } },
});

function parseArgs(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

async function runClaude(input, threadId, emit) {
  const messages = input.messages || [];
  const last = messages[messages.length - 1];
  // The follow-up run after the page ran a render tool: Claude already went on within its turn.
  if (!last || last.role !== 'user') return;
  const frontend = (input.tools || []).map((t) => t.name);
  const first = messages.filter((m) => m.role === 'user').length === 1;
  const content = first
    ? `${claudePreamble(input.context, frontend)}\n\n## The user's request\n${textOf(last.content)}`
    : `(team-hours-report page; build the report with the team-hours-report tools)\n\n${textOf(last.content)}`;
  const steps = await muster.turn(`team-hours-report-${threadId}`, content);
  steps.forEach((st) => {
    const messageId = newId('msg');
    if (st.text || st.error) {
      emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
      emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: st.text || `⚠ ${st.error}` });
      emit({ type: 'TEXT_MESSAGE_END', messageId });
      return;
    }
    emit({ type: 'TOOL_CALL_START', toolCallId: st.id, toolCallName: st.tool, parentMessageId: messageId });
    emit({ type: 'TOOL_CALL_ARGS', toolCallId: st.id, delta: JSON.stringify(st.args) });
    emit({ type: 'TOOL_CALL_END', toolCallId: st.id });
    if (frontend.indexOf(st.tool) < 0) {
      emit({ type: 'TOOL_CALL_RESULT', messageId: newId('msg'), toolCallId: st.id, content: st.result || '', role: 'tool' });
    }
  });
}

async function run(input, emit) {
  const threadId = input.threadId || newId('thread');
  const runId = input.runId || newId('run');
  emit({ type: 'RUN_STARTED', threadId, runId });

  try {
    if (global.context.env.CHAT_ENGINE !== 'local') {
      await runClaude(input, threadId, emit);
      emit({ type: 'RUN_FINISHED', threadId, runId });
      return;
    }
    const frontendTools = (input.tools || []).map(toOpenAiTool);
    const tools = datasets.tools.concat(frontendTools);
    const messages = [{ role: 'system', content: systemPrompt(input.context, frontendTools.map((t) => t.function.name)) }]
      .concat(toOpenAiMessages(input.messages));

    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await llm.chat({ messages, tools });
      const text = cleanText(reply.content);
      const calls = reply.tool_calls || [];
      const messageId = newId('msg');

      if (text) {
        emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
        emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text });
        emit({ type: 'TEXT_MESSAGE_END', messageId });
      }
      if (!calls.length) break;

      calls.forEach((c) => {
        c.id = c.id || newId('call');
        emit({ type: 'TOOL_CALL_START', toolCallId: c.id, toolCallName: c.function.name, parentMessageId: messageId });
        emit({ type: 'TOOL_CALL_ARGS', toolCallId: c.id, delta: c.function.arguments || '{}' });
        emit({ type: 'TOOL_CALL_END', toolCallId: c.id });
      });

      const serverCalls = calls.filter((c) => datasets.has(c.function.name));
      messages.push({ role: 'assistant', content: text, tool_calls: calls });
      for (let i = 0; i < serverCalls.length; i++) {
        const c = serverCalls[i];
        const content = await datasets.call(c.function.name, parseArgs(c.function.arguments));
        emit({ type: 'TOOL_CALL_RESULT', messageId: newId('msg'), toolCallId: c.id, content, role: 'tool' });
        messages.push({ role: 'tool', tool_call_id: c.id, content });
      }

      // Any frontend tool call hands the turn to the browser.
      if (serverCalls.length < calls.length) break;
    }

    emit({ type: 'RUN_FINISHED', threadId, runId });
  } catch (e) {
    console.error('agui run error:', e.message);
    emit({ type: 'RUN_ERROR', message: e.message, code: 'agent_error' });
  }
}

module.exports = { run };
