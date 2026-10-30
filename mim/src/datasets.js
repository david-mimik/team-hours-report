// Report data kept in the mim's storage, and the server-side tools the agent uses to read it.
// Datasets are { id, title, description, rows: [{ column: value }] }, stored under the 'dataset' tag.
const teamtime = require('./teamtime');
const agile = require('./agile');

const TAG = 'dataset';
const KEY = (id) => `dataset:${id}`;
const MAX_ROWS_TO_LLM = 100;

function list() {
  const out = [];
  global.context.storage.eachItemByTag(TAG, (key, value) => {
    const d = JSON.parse(value);
    out.push({ id: d.id, title: d.title, description: d.description, rowCount: d.rows.length });
    return true;
  });
  return out;
}

function get(id) {
  const value = global.context.storage.getItem(KEY(id));
  return value ? JSON.parse(value) : null;
}

function put(id, d) {
  if (!d || !Array.isArray(d.rows)) throw new Error('A dataset needs a "rows" array');
  const dataset = { id, title: d.title || id, description: d.description || '', rows: d.rows };
  global.context.storage.setItemWithTag(KEY(id), JSON.stringify(dataset), TAG);
  return dataset;
}

function remove(id) {
  global.context.storage.removeItem(KEY(id));
}

// Column statistics, so a small model does not have to add numbers up itself.
function describe(d) {
  const columns = {};
  d.rows.forEach((row) => {
    Object.keys(row).forEach((c) => {
      const col = columns[c] || (columns[c] = { name: c, numeric: true, values: [] });
      if (typeof row[c] !== 'number') col.numeric = false;
      col.values.push(row[c]);
    });
  });
  return Object.keys(columns).map((c) => {
    const col = columns[c];
    if (!col.numeric) {
      const distinct = col.values.filter((v, i, a) => a.indexOf(v) === i);
      return { name: c, type: 'category', distinct: distinct.slice(0, 50) };
    }
    const sum = col.values.reduce((a, b) => a + b, 0);
    return {
      name: c, type: 'number', sum, avg: sum / col.values.length,
      min: Math.min.apply(null, col.values), max: Math.max.apply(null, col.values),
    };
  });
}

// --- Server-side tools (executed in the mim; the browser only sees their results). getTeamTime lives in teamtime.js. ---

const tools = teamtime.tools.concat(agile.tools, [
  {
    type: 'function',
    function: {
      name: 'listDatasets',
      description: 'List the extra tables someone uploaded with PUT /datasets/{id} (often none). Team hours and agile metrics come from the other tools.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDataset',
      description: 'Get the rows of a dataset and per-column statistics (sum, avg, min, max, distinct values).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Dataset id from listDatasets' } },
        required: ['id'],
      },
    },
  },
]);

const handlers = Object.assign({}, teamtime.handlers, agile.handlers, {
  listDatasets: () => list(),
  getDataset: ({ id }) => {
    const d = get(id);
    if (!d) return { error: `No dataset "${id}"` };
    return {
      id: d.id, title: d.title, rowCount: d.rows.length,
      columns: describe(d),
      rows: d.rows.slice(0, MAX_ROWS_TO_LLM),
      truncated: d.rows.length > MAX_ROWS_TO_LLM,
    };
  },
});

function has(name) {
  return Object.prototype.hasOwnProperty.call(handlers, name);
}

async function call(name, args) {
  try {
    return JSON.stringify(await handlers[name](args || {}));
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

module.exports = { list, get, put, remove, tools, has, call };
