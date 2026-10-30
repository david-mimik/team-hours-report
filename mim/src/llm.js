// One chat completion against the node's OpenAI-compatible inference API (AI router by default, or milm directly
// with INFERENCE_BASE_URI=/mimik-ai/openai/v1/chat/completions).
// Not streamed: context.http has no streaming callback, so the AG-UI layer emits each reply as a whole.
const { requestAction } = require('./http');

async function chat({ messages, tools }) {
  const { httpPort } = global.context.info;
  const { INFERENCE_API_KEY, INFERENCE_MODEL, INFERENCE_BASE_URI, THINKING_MODE, MAX_TOKENS } = global.context.env;

  const body = {
    model: INFERENCE_MODEL || 'Qwen3.5-4B-Q8_0',
    messages,
    stream: false,
    max_tokens: Number(MAX_TOKENS) || 2000,
  };
  // Thinking makes each step minutes long on a small local model; off by default (THINKING_MODE=on to enable).
  if (THINKING_MODE !== 'on') {
    body.chat_template_kwargs = { enable_thinking: false };
    if (messages[0] && messages[0].role === 'system') {
      body.messages = [{ role: 'system', content: `${messages[0].content}\n/no_think` }].concat(messages.slice(1));
    }
  }
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await requestAction({
    url: `http://127.0.0.1:${httpPort}${INFERENCE_BASE_URI || '/mimik-airouter/openai/v1/chat/completions'}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authorization: `Bearer ${INFERENCE_API_KEY}`,
    jsonBody: body,
    socketTimeout: 150000,
  });

  const parsed = JSON.parse(res.data);
  const choice = parsed.choices && parsed.choices[0];
  if (!choice) throw new Error(`Inference returned no choices: ${res.data.slice(0, 200)}`);
  return choice.message || {};
}

module.exports = { chat };
