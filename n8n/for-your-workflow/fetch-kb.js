// [8] Assemble KB pages + build prompt inputs — Code node
// The page bodies are fetched by the "Notion · KB Page" node, which returns ONE ITEM PER BLOCK
// across all requested pages. Blocks are grouped back by their parent page id here.
// Reached from two branches: with blocks (Has KB? = true) or straight from Merge State (no kb_ids).

const ctx = $('Merge State4').first().json;
const S = ctx.S;
const store = $getWorkflowStaticData('global');
store.kb_pages = store.kb_pages || {};

const blockText = (b) => {
  const t = b[b.type];
  if (!t) return '';
  const rich = t.rich_text || t.text || [];
  const s = Array.isArray(rich) ? rich.map(v => v.plain_text || '').join('') : '';
  if (!s) return '';
  if (b.type === 'heading_1') return '\n## ' + s;
  if (b.type === 'heading_2') return '\n### ' + s;
  if (b.type === 'heading_3') return '\n#### ' + s;
  if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') return '- ' + s;
  if (b.type === 'quote' || b.type === 'callout') return '> ' + s;
  return s;
};

// ── group blocks by page ───────────────────────────────────────────────────
const byPage = {};
if (ctx.kb_ids.length) {
  const blocks = $input.all().map(i => i.json).filter(b => b && b.type);
  for (const b of blocks) {
    // Raw Notion blocks carry parent.page_id. If that is missing and only one page was requested,
    // every block must belong to it.
    let pid = String(b.parent?.page_id || '').replace(/-/g, '');
    if (!pid && ctx.kb_ids.length === 1) pid = ctx.kb_ids[0];
    if (!pid) continue;
    (byPage[pid] = byPage[pid] || []).push(b);
  }
}

const docs = [];
for (const id of ctx.kb_ids) {
  const meta = ctx.kb_index.find(r => r.id === id);
  if (!meta) continue;

  let text = '';
  if (byPage[id]?.length) {
    text = byPage[id].map(blockText).filter(Boolean).join('\n').trim();
    // Retrieved content is DATA. Strip instruction-shaped lines before they ever reach a prompt.
    text = text.split('\n').filter(l => !/^\s*(ignore|disregard|you are|you must|system:|assistant:|as an ai)\b/i.test(l)).join('\n').slice(0, 6000);
    store.kb_pages[id] = { at: Date.now(), text };
  } else if (store.kb_pages[id]) {
    text = store.kb_pages[id].text;   // Notion failed this turn: serve the last good copy
  }
  if (text) docs.push({ ...meta, text });
}

// prune the page cache so static data stays small
const cachedIds = Object.keys(store.kb_pages);
if (cachedIds.length > 60) for (const id of cachedIds.slice(0, cachedIds.length - 60)) delete store.kb_pages[id];

// ── context block: the ONLY company facts the advisor may use ──────────────
// Only angle brackets need neutralising — they are what could forge a </doc> or a fake <system> tag.
// Escaping & as well turned "Build & integrate" into "Build &amp; integrate" in the prompt, and the
// advisor then repeated the entity back to the visitor.
const esc = (s) => String(s).replace(/</g, '‹').replace(/>/g, '›');
const kb_context = docs.map(d =>
  `<doc id="${d.id}" title="${esc(d.title)}" pricing_allowed="${d.pricing}">\n${esc(d.text)}\n</doc>`
).join('\n');

// Support level, deterministic: did the router find anything, and did it load?
const needs_kb = !['UNRELATED','GENERAL_KNOWLEDGE','STARTUP_ADVICE'].includes(ctx.intent);
const support = !needs_kb ? 'NOT_NEEDED' : docs.length >= 2 ? 'SUPPORTED' : docs.length === 1 ? 'PARTIAL' : 'NOT_SUPPORTED';
if (needs_kb && support === 'NOT_SUPPORTED' && ['COMPANY','SERVICE','PRICING'].includes(ctx.intent)) S.flags.no_kb += 1;
else S.flags.no_kb = 0;

// Every currency amount present in pricing-allowed docs. The output validator rejects anything else.
const allowed_prices = new Set();
for (const d of docs) {
  if (!d.pricing) continue;
  for (const m of d.text.matchAll(/(?:\$|usd\s?)\s?(\d{1,3}(?:,\d{3})*)(?:\s?(?:–|-|to)\s?\$?\s?(\d{1,3}(?:,\d{3})*))?/gi)) {
    const n = (s) => s.replace(/,/g, '');
    allowed_prices.add(n(m[1]));
    if (m[2]) allowed_prices.add(n(m[2]));
  }
  for (const m of d.text.matchAll(/(\d{1,3})\s?%/g)) allowed_prices.add(m[1] + '%');
}
const pricing_mode = (docs.some(d => d.pricing) && support !== 'NOT_SUPPORTED') ? 'published' : 'unknown';

// ── compact state summary (no scores, ever) ───────────────────────────────
const a = (k) => S.attrs[k]?.v || null;
const bits = [];
const who = [a('business_type'), a('team_size') ? `${a('team_size')} people` : null, a('business_stage')?.replace(/_/g, ' ')].filter(Boolean).join(', ');
bits.push(`Visitor: ${who || 'unknown so far'}.`);
if (a('primary_goal')) bits.push(`Goal: ${a('primary_goal')}.`);
if (a('primary_problem')) bits.push(`Problem: ${a('primary_problem')}.`);
if (a('timeline')) bits.push(`Timeline: ${a('timeline').replace(/_/g, ' ')}.`);
if (a('existing_solution')) bits.push(`Has today: ${a('existing_solution')}.`);
if (a('decision_stage')) bits.push(`Decision stage: ${a('decision_stage')}.`);
bits.push(`Recommended so far: ${S.rec.length ? S.rec.join(', ') : 'none'}.`);
bits.push(`Contact: ${S.contact.email ? 'email given' : 'none'}.`);
if (S.flags.pricing_asked) bits.push('Has asked about pricing.');

const CTA_BY_PHASE = {
  DIAGNOSING: ['none', 'educational', 'insufficient'],
  ADVISORY: ['none', 'insufficient'],
  RECOMMENDING: ['none', 'educational', 'service', 'low_intent', 'consultation'],
  QUALIFYING: ['none', 'service', 'consultation', 'high_intent'],
  CAPTURING: ['none', 'consultation'],
  HANDOFF: ['consultation', 'high_intent'],
};
let ask_contact = null;
if (S.phase === 'CAPTURING' && !S.flags.declined) ask_contact = !S.contact.email ? 'email' : (!S.contact.name ? 'name' : null);

// ── narrow before explaining? ─────────────────────────────────────────
// A paragraph buried in a long system prompt is a suggestion; a flag in <turn_instructions> is an
// instruction. The advisor kept answering "I want a website" with the whole brochure because
// nothing in the turn itself told it not to. That decision is mechanical, so it belongs here: if
// nothing concrete is known about the visitor's business, no answer can be materially right, and
// the turn has to ask before it explains. The question and the tappable options stay the model's —
// only the decision to narrow is ours, which keeps it true for any topic instead of a fixed menu.
const TELLS = ['business_type', 'business_stage', 'primary_problem', 'primary_goal', 'existing_solution'];
const NARROWABLE = ['SERVICE', 'BUYING_INTENT', 'UNSURE_WHAT_I_NEED', 'GENERAL', 'COMPANY', 'PRICING', 'STARTUP_ADVICE'];
const narrow_first = S.turn <= 2
  && !S.contact.email
  && NARROWABLE.includes(ctx.intent)
  && TELLS.every(k => (S.attrs[k]?.c || 0) < 0.6);

// Nothing useful has been said yet, so there is nothing to book a call about and no reason anyone
// would hand over an email. Take both off the table for this turn.
let allowed_cta = CTA_BY_PHASE[S.phase] || ['none'];
if (narrow_first) { allowed_cta = ['none', 'insufficient']; ask_contact = null; }

// Every question spends the visitor's patience, and they came here for an answer. Two is a
// conversation; a third starts to feel like a form. After that the turn answers and offers the
// next step instead — the team can ask the rest on the call.
const may_ask_question = narrow_first || (S.questions || []).length < 2;

return [{
  json: {
    ...ctx, S,
    docs_used: docs.map(d => d.id),
    kb_context,
    support,
    pricing_mode,
    allowed_prices: Array.from(allowed_prices),
    state_summary: bits.join(' '),
    recent_turns: S.history.slice(-6).map(t => (t.r === 'u' ? 'Visitor: ' : 'Advisor: ') + t.x).join('\n'),
    allowed_cta,
    ask_contact,
    narrow_first,
    may_ask_question,
    known_attrs: Object.entries(S.attrs).filter(([, v]) => v.c >= 0.6).map(([k]) => k),
  },
}];
