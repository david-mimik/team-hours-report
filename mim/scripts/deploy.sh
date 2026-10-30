#!/usr/bin/env bash
# Deploy the team-hours-report mim to the local mimOE node, then upload the report page (web/dist) into it.
#   ./scripts/deploy.sh              upload image + deploy + upload page (fails if already deployed)
#   ./scripts/deploy.sh --redeploy   remove the existing mim + image first
#   ./scripts/deploy.sh --ui         upload the page only (after npm --prefix web run build)
#   ./scripts/deploy.sh --remove     remove only
# Env: MIMOE_URL (default http://localhost:8083), INFERENCE_BASE_URI, INFERENCE_MODEL, INFERENCE_API_KEY, WRITE_API_KEY,
#      and for Team Time: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, TEMPO_BASE_URL, TEMPO_API_TOKEN, TEAM_PROJECTS,
#      TEAM_EXTRA_WORKLOGS, TEAM_HISTORY_MONTHS; for the chat: CHAT_ENGINE (claude | local), MUSTER_URL, MUSTER_API_KEY,
#      CLAUDE_MODEL. Any of them not set in the environment is read from ../.env (gitignored).
#      Claude Code also needs the mim's MCP endpoint in the gateway, granted to Muster: node scripts/claude-setup.cjs
set -euo pipefail

cd "$(dirname "$0")/.."
NAME=team-hours-report
IMAGE="$NAME-v1"
VERSION=$(node -p "require('./package.json').version")
TAR="deploy/$IMAGE-$VERSION.tar"
NODE_URL="${MIMOE_URL:-http://localhost:8083}"

for f in .mimoe/mimoe-api-key.env "$HOME/.mimoe/mimoe-api-key.env"; do
  if [[ -z "${MCM_API_KEY:-}" && -f "$f" ]]; then
    MCM_API_KEY=$(grep '^MCM_API_KEY=' "$f" | cut -d= -f2-)
  fi
done
[[ -n "${MCM_API_KEY:-}" ]] || { echo "No MCM_API_KEY (looked in ~/.mimoe/mimoe-api-key.env)"; exit 1; }
AUTH="Authorization: Bearer $MCM_API_KEY"

# ids of our mim / image, by name
ids() { curl -s "$NODE_URL/mcm/v1/$1" -H "$AUTH" | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const d=(JSON.parse(s||'{}').data)||[];
    d.filter(x=>x.name==='$2'||x.image==='$2').forEach(x=>console.log(x.id));})"; }

remove() {
  for id in $(ids mims "$IMAGE"); do echo "remove mim $id"; curl -s -o /dev/null -X DELETE "$NODE_URL/mcm/v1/mims/$id" -H "$AUTH"; done
  for id in $(ids images "$IMAGE"); do echo "remove image $id"; curl -s -o /dev/null -X DELETE "$NODE_URL/mcm/v1/images/$id" -H "$AUTH"; done
}

BASE="$NODE_URL/api/$NAME/v1"

upload_ui() { node scripts/upload-ui.cjs "$BASE"; }

case "${1:-}" in
  --remove) remove; exit 0 ;;
  --ui) upload_ui; exit 0 ;;
  --redeploy) remove ;;
esac

[[ -f "$TAR" ]] || { echo "Missing $TAR. Run: npm run build (from the project root)"; exit 1; }

echo "upload $TAR"
curl -sf -X POST "$NODE_URL/mcm/v1/images" -H "$AUTH" -F "image=@$TAR" > /dev/null

echo "deploy $NAME"
BODY=$(node -e "
  const b=require('./config/start-example.json');
  const fs=require('fs');
  const file=fs.existsSync('../.env')?Object.fromEntries(fs.readFileSync('../.env','utf8').split(/\r?\n/)
    .filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])):{};
  const e=Object.assign({},file,process.env);
  ['INFERENCE_BASE_URI','INFERENCE_MODEL','INFERENCE_API_KEY','WRITE_API_KEY','JIRA_BASE_URL','JIRA_EMAIL','JIRA_API_TOKEN',
   'TEMPO_BASE_URL','TEMPO_API_TOKEN','TEAM_PROJECTS','TEAM_EXTRA_WORKLOGS','TEAM_HISTORY_MONTHS',
   'CHAT_ENGINE','MUSTER_URL','MUSTER_API_KEY','CLAUDE_MODEL']
    .forEach(k=>{if(e[k])b.env[k]=e[k];});
  console.log(JSON.stringify(b));")
curl -sf -X POST "$NODE_URL/mcm/v1/mims" -H "$AUTH" -H "Content-Type: application/json" -d "$BODY" > /dev/null

echo "healthcheck: $(curl -s "$BASE/healthcheck" | head -c 80)"
upload_ui
echo "report UI:   $BASE/"
