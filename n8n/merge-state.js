// [6] Merge router output into state + resolve categories to pages — Code node
// Inputs: router LLM output ($json.output) ; context from "KB Index".
// The router proposes; deterministic rules decide. Security and phase are never left to the model.

const ctx = $('KB Index').first().json;
const S = JSON.parse(JSON.stringify(ctx.S));
const sec = ctx.security;

// There is no output-parser sub-node, so the model's answer arrives as plain text in `.text`.
// Parsing it here costs nothing and survives the things models actually do: a ```json fence,
// a sentence before the object, a trailing comma.
const parseJson = (v) => {
  if (v && typeof v === 'object') return v;
  let s = String(v == null ? '' : v).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) {}
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (e) { return null; }
};

const raw = $input.first().json;
let r = parseJson(raw.output ?? raw.text ?? raw.response ?? raw);

// Router failure → safe defaults, conversation continues.
if (!r || !r.intent) {
  r = { intent: 'GENERAL', security_category: 'none', categories: [], questions: [], attributes: {},
        signals: { hire: false, call: false, price: false, timeline_near: false, just_researching: false, negotiation: false, complexity_high: false, needs_human_approval: false },
        _failed: true };
}

let intent = sec.forced_intent || r.intent;

// Tapping "Talk to the team" sends "I'd like to talk to the team". The router called that GENERAL,
// no category matched, nothing was retrieved — and the visitor who had just asked to be handed over
// got "I don't have enough to answer that accurately". An explicit request for a person is the one
// thing that must never depend on a model call, so it is decided here instead.
const WANTS_HUMAN = /\b(talk|speak|chat|connect|put)\s+(me\s+|us\s+)?(through\s+)?(to|with)\s+(the\s+|a\s+|an\s+|someone\s+)?(team|someone|somebody|human|person|sales|advisor|expert)\b|\b(call|contact|ring)\s+me\b|\bbook\s+a\s+(call|time|meeting|slot|consultation)\b/i;
if (!sec.forced_intent && WANTS_HUMAN.test(ctx.payload.message)) intent = 'HUMAN_REQUEST';

S.turn += 1;
const turn = S.turn;

// ── attributes: new value wins only if it is at least as confident ─────────
const KEYS = ['business_stage','business_type','team_size','primary_goal','primary_problem','requested_service','timeline','urgency','existing_solution','website','budget_signal','decision_stage','company','name','email'];
for (const k of KEYS) {
  const a = r.attributes?.[k];
  if (!a || a.value == null || a.value === '' || !(a.confidence > 0)) continue;
  const old = S.attrs[k];
  if (!old || a.confidence >= old.confidence - 0.1) {
    S.attrs[k] = { v: String(a.value).slice(0, 160), c: Math.min(1, Number(a.confidence)), t: turn };
  }
}
if (ctx.payload.urls.length && !S.attrs.website && /\b(our|my) (site|website)\b/i.test(ctx.payload.message)) {
  S.attrs.website = { v: ctx.payload.urls[0].slice(0, 160), c: 0.7, t: turn };
}
const email = S.attrs.email?.v;
if (email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && S.attrs.email.c >= 0.8) S.contact.email = email.toLowerCase();
if (S.attrs.name?.v && S.attrs.name.c >= 0.8) S.contact.name = S.attrs.name.v;
if (S.attrs.company?.v && S.attrs.company.c >= 0.7) S.contact.company = S.attrs.company.v;

// ── flags ─────────────────────────────────────────────────────────────────
const sig = r.signals || {};
if (sec.hard || ['PROMPT_INJECTION','INTERNAL_INFO'].includes(intent)) S.flags.security_hits += 1;
if (intent === 'ABUSIVE') S.flags.abusive += 1;
if (S.flags.abusive >= 5) S.flags.muted_until = Date.now() + 600000;
S.flags.offtopic = ['UNRELATED','GENERAL_KNOWLEDGE'].includes(intent) ? S.flags.offtopic + 1 : 0;
if (intent === 'PRICING' || sig.price) S.flags.pricing_asked = true;
if (intent === 'VENDOR_PITCH') S.flags.vendor_pitch = true;
if (intent === 'HUMAN_REQUEST' || sig.call || sig.negotiation || sig.needs_human_approval || sig.complexity_high) S.flags.handoff = true;
if (intent === 'SENSITIVE' && /complain|refund|unhappy|disappointed/i.test(ctx.payload.message)) S.flags.handoff = true;
if (S.phase === 'CAPTURING' && /\b(no thanks|rather not|don't want to share|i'll book|book directly|skip)\b/i.test(ctx.payload.message)) S.flags.declined = true;
if (S.flags.offtopic >= 3) S.flags.closing = true;

// ── phase ─────────────────────────────────────────────────────────────────
const c = (k) => S.attrs[k]?.c || 0;
const understanding = (c('primary_problem') + c('primary_goal') + c('business_stage') + c('business_type')) / 4;
if (intent === 'UNSURE_WHAT_I_NEED' && S.phase === 'DIAGNOSING') S.phase = 'ADVISORY';
if (S.phase === 'ADVISORY' && c('primary_goal') >= 0.6) S.phase = 'RECOMMENDING';
if (S.phase === 'DIAGNOSING' && understanding >= 0.6 && (c('primary_problem') >= 0.6 || c('primary_goal') >= 0.6)) S.phase = 'RECOMMENDING';
// "I want a website" sets hire on the very first message. Letting that alone move the phase to
// CAPTURING is what made the advisor ask for an email underneath its first answer — before the
// visitor had said one thing about their business. Interest is not a decision: wait until they
// have told us something, or until the conversation has actually gone somewhere.
const TELLS = ['business_type', 'business_stage', 'primary_problem', 'primary_goal', 'existing_solution'];
const knowsSomething = TELLS.some(k => (S.attrs[k]?.c || 0) >= 0.6);
if (S.flags.handoff || S.attrs.decision_stage?.v === 'ready' || (sig.hire && (turn >= 2 || knowsSomething))) {
  S.phase = (S.contact.email || S.flags.declined) ? 'HANDOFF' : 'CAPTURING';
}
if (S.phase === 'CAPTURING' && S.contact.email) S.phase = 'HANDOFF';

// ── route: safe template, or fetch KB and generate ────────────────────────
const SAFE = ['PROMPT_INJECTION','INTERNAL_INFO','ABUSIVE','VENDOR_PITCH','UNRELATED','GENERAL_KNOWLEDGE','SENSITIVE'];
const route = SAFE.includes(intent) ? 'safe' : 'generate';

// ── categories → pages ────────────────────────────────────────────────────
// The router names categories, not entries. Everything filed under those categories is a candidate,
// so a new Notion entry is picked up the moment it is approved — nobody has to update this workflow.
// Only the cap below is ours: enough pages to answer properly, few enough to keep the prompt sane.
const MAX_PAGES = 6;
const MAX_CHARS = 18000;

// The catalog is written the way Notion stores it — "website-development", "Process (public)" —
// and the router, asked for a category, hands back the human spelling: "Website Development".
// An exact string compare threw that away, nothing was retrieved, and a perfectly good answer was
// then rejected for being ungrounded. Match on a slug so spelling, case and punctuation stop
// mattering; the model still cannot invent a category that is not in the database.
// Filler words are the difference between "Branding and Growth" and the tag "branding-growth",
// and they carry no meaning, so they never take part in the comparison.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-')
  .filter(w => w && !['and', 'the', 'of', 'for', 'a', 'an'].includes(w)).join('-');
const known = new Map();
for (const c2 of ctx.kb_catalog || []) known.set(slug(c2.name), c2.name.toLowerCase());

const lookup = (raw) => {
  // "area:x" prefixes and titles like "Service \u2014 Website Development" both reduce to a few
  // fragments. Take the LONGEST fragment the database recognises, so the specific area wins over
  // the generic kind sitting in front of it.
  const parts = [String(raw), String(raw).split(':').pop(), ...String(raw).split(/[:\u2014\u2013|\/,]/)];
  let best = null;
  for (const part of parts) {
    const k = slug(part);
    if (!k) continue;
    let hit = known.get(k);
    // The router writes the human spelling, the database a short tag: "Sales & Lead Generation"
    // against "sales-lead-gen". One being the start of the other is close enough to be the same
    // thing, and long enough that two different categories cannot collide.
    if (!hit) {
      const kt = k.split('-');
      for (const [ck, name] of known) {
        if (ck.length < 8) continue;
        if (k.startsWith(ck) || ck.startsWith(k)) { hit = name; break; }
        // "Business & Startup Advisory" against the tag "business-advisory": neither contains the
        // other, but every word of the tag is in the phrase, which is only true of the same thing.
        const ct = ck.split('-');
        if (ct.length >= 2 && ct.every(w => kt.includes(w))) { hit = name; break; }
      }
    }
    if (hit && (!best || slug(part).length > best.len)) best = { name: hit, len: k.length };
  }
  return best && best.name;
};

const chosen = [];
for (const raw of r.categories || []) {
  const hit = lookup(raw);
  if (hit && !chosen.includes(hit)) chosen.push(hit);
}

// A visitor answering "Local service or retail" reads, to the router, as someone describing their
// situation — so it returns no categories, nothing is retrieved, and the turn that finally HAS
// something worth saying is the one rejected for being ungrounded. But the subject did not change
// when they answered the question we asked: it is still the website. Carry the last one forward.
if (chosen.length) S.last_categories = chosen.slice();
else if (turn > 1 && route === 'generate' && Array.isArray(S.last_categories)) chosen.push(...S.last_categories);

const wantsPricing = intent === 'PRICING' || sig.price || S.flags.pricing_asked;

const scored = (ctx.kb_index || []).map(row => {
  const labels = [...row.tags, row.type].filter(Boolean).map(s => s.toLowerCase());
  let score = chosen.reduce((n, cat) => n + (labels.includes(cat) ? 1 : 0), 0);
  if (!score) return null;
  // A pricing question that pulled a pricing category should read the priced entries first.
  if (wantsPricing && row.pricing) score += 0.5;
  if (labels.includes('cross-service')) score -= 0.25;   // broad entries yield to specific ones
  return { row, score };
}).filter(Boolean).sort((a, b) => b.score - a.score);

const kb_ids = [];
let budget = MAX_CHARS;
for (const { row } of scored) {
  if (kb_ids.length >= MAX_PAGES) break;
  const cost = 600 + (row.summary || '').length;   // rough; the real text is capped per page later
  if (budget - cost < 0 && kb_ids.length) break;
  budget -= cost;
  kb_ids.push(row.id);
}

return [{
  json: {
    ...ctx, S, intent, router: r, signals: sig, route, kb_ids,
    categories: chosen,
    questions: Array.isArray(r.questions) ? r.questions.slice(0, 3) : [],
    understanding, turn,
  },
}];
