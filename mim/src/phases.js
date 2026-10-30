// SDLC phase of a Jira issue. The rules run in order and the first that matches wins; nothing is guessed:
//   1. the issue's first component that maps to a phase (COMPONENTS)
//   2. issue type Bug -> Fixing defects
//   3. a label in LABELS
//   4. the same rules on the parent (sub-tasks and stories under an epic)
//   otherwise Unclassified.
// The page's PHASES (web/src/teamtime/model.ts) use the same order of indexes.
const PHASES = ['Requirements', 'Design', 'Development', 'Testing', 'Fixing defects', 'Planning & process', 'Unclassified'];
const UNCLASSIFIED = 6;

const COMPONENTS = {
  'Product & Documentation': 0,
  'Design: Operations': 1,
  'Design: Product Design': 1,
  'Design: Prototyping & Validation': 1,
  'Design: Research & Exploration': 1,
  'Design: System Design': 1,
  'Agents & UI Mims': 2,
  'Applications (App Layer)': 2,
  'Authentication & User Management': 2,
  'Backend – APIs': 2,
  'Backend – Core Services': 2,
  'CBT System': 2,
  'Client & Edge Libraries': 2,
  'Cloud & Infrastructure': 2,
  'Concierge / Feed': 2,
  'Configuration & Provisioning': 2,
  'Cross-Service': 2,
  'Data & Analytics': 2,
  'Database & Data Storage': 2,
  'DevOps & CI/CD': 2,
  Feed: 2,
  'Frontend – Android Mobile': 2,
  'Frontend – iOS Mobile': 2,
  'Frontend – Web': 2,
  'Microservices (Edge & Backend)': 2,
  'Monitoring, Logging & Performance': 2,
  Notifications: 2,
  'Optimization, Technical Debt & Improvements': 2,
  'Partner Dashboard': 2,
  'Platform Analytics': 2,
  'Provider Portal': 2,
  Recovery: 2,
  'Security & Compliance': 2,
  'Storage / mimOE': 2,
  'Substrate / Ingestion': 2,
  'User Onboarding': 2,
  'Testing & Quality Assurance': 3,
  'Delivery & Agile Processes': 5,
};
const LABELS = { testing: 3, 'ux-ui': 1 };

// fields: a Jira issue's fields (components, issuetype, labels). Returns [phase, how] or null.
function ownRule(f) {
  const comps = (f && f.components) || [];
  for (let i = 0; i < comps.length; i++) {
    const name = String(comps[i].name || '').trim();
    if (Object.prototype.hasOwnProperty.call(COMPONENTS, name)) return [COMPONENTS[name], `Component “${name}”`];
  }
  if (f && f.issuetype && f.issuetype.name === 'Bug') return [4, 'Issue type Bug'];
  const labels = (f && f.labels) || [];
  for (let i = 0; i < labels.length; i++) {
    const l = String(labels[i]).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LABELS, l)) return [LABELS[l], `Label ${labels[i]}`];
  }
  return null;
}

// Components that appear on issues but map to no phase (so they can be added to COMPONENTS).
function unmappedComponents(f) {
  return ((f && f.components) || []).map((c) => String(c.name || '').trim()).filter((n) => n && !Object.prototype.hasOwnProperty.call(COMPONENTS, n));
}

module.exports = { PHASES, UNCLASSIFIED, ownRule, unmappedComponents };
