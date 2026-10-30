// Upload the built report page (web/dist) into the deployed mim: PUT <base>/ui/<file> with { text }.
// JSON bodies only: the mimOE gateway does not pass text/plain or octet-stream bodies to a mim.
//   node scripts/upload-ui.cjs <mim base url>     e.g. http://localhost:8083/api/team-hours-report/v1
// Env: WRITE_API_KEY (when the mim is deployed with one).
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2];
const DIST = path.resolve(__dirname, '../../web/dist');
const CONCURRENCY = 8;

async function put(file) {
  const res = await fetch(`${BASE}/ui/${file}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WRITE_API_KEY || ''}` },
    body: JSON.stringify({ text: fs.readFileSync(path.join(DIST, file), 'utf8') }),
  });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${await res.text()}`);
}

(async () => {
  if (!BASE) throw new Error('usage: node scripts/upload-ui.cjs <mim base url>');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('Missing web/dist. Run: npm --prefix web run build');
  // index.html last, so the page never points at chunks that are not there yet
  const files = fs.readdirSync(DIST).filter((f) => /\.(js|css)$/.test(f) || (/\.html$/.test(f) && f !== 'index.html')).concat('index.html');
  for (let i = 0; i < files.length - 1; i += CONCURRENCY) await Promise.all(files.slice(i, Math.min(i + CONCURRENCY, files.length - 1)).map(put));
  await put('index.html');
  console.log(`uploaded ${files.length} page files`);
})().catch((e) => { console.error(e.message); process.exit(1); });
