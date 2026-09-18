// [12] Qualification + CTA — Code node (deterministic; docs/04 is the spec)
// The model proposed a cta_intent; this table decides what the visitor actually sees.

const SITE = 'https://simplifiedstartup.com';

const x = $input.first().json;
const S = x.S;
const { gen, intent } = x;
const sig = x.signals || {};
const a = (k) => S.attrs[k]?.v || null;
const c = (k) => S.attrs[k]?.c || 0;

const NAMES = {
  'digital-marketing': 'Digital Marketing', 'website-development': 'Website Development', 'branding-growth': 'Branding & Growth',
  'sales-lead-gen': 'Sales & Lead Generation', 'ai-automation': 'AI Automation', 'business-advisory': 'Business & Startup Advisory',
  'talent-staffing': 'Talent & Staffing', 'bookkeeping': 'Bookkeeping & Accounting',
};
const SLUGS = Object.keys(NAMES);

// ── recommendations ───────────────────────────────────────────────────────
const proposed = (gen.recommended_services || []).filter(s => SLUGS.includes(s));
if (proposed.length && x.support !== 'NOT_SUPPORTED' && !x.fallback) {
  S.rec = [proposed[0]];
  S.sec_rec = proposed.slice(1, 3);
  S.reasoning = (gen.reply.split(/\n\s*\n/)[1] || gen.reply.split(/\n\s*\n/)[0] || '').slice(0, 200);
}

// ── scores (never shown to the visitor) ───────────────────────────────────
const signals = [];
let it = 0;
const add = (w, label) => { it += w; signals.push(label); };
if (sig.hire) add(0.40, 'hire');
if (sig.call) add(0.35, 'call');
if (sig.price || intent === 'PRICING') add(0.20, 'price');
if (sig.timeline_near || ['asap', '1_3_months'].includes(a('timeline'))) add(0.20, 'timeline≤3m');
else if (a('timeline') === '3_6_months') add(0.10, 'timeline 3–6m');
if (a('decision_stage') === 'comparing') add(0.15, 'comparing');
if (a('decision_stage') === 'ready') add(0.30, 'ready');
if (a('budget_signal')) add(0.15, 'budget');
if (S.contact.company || a('website')) add(0.10, 'company/site');
if (S.contact.email) add(0.25, 'email');
if (sig.just_researching) add(-0.30, 'researching');
if (S.flags.vendor_pitch) add(-0.60, 'vendor');
it = Math.max(0, Math.min(1, Math.max(it, (S.score.intent || 0) * 0.85)));

let fit = 0;
if (S.rec.length && (c('primary_problem') >= 0.6 || c('primary_goal') >= 0.6)) fit += 0.5;
const bt = (a('business_type') || '').toLowerCase();
if (bt && !/enterprise|fortune|government|personal|hobby|student/.test(bt)) fit += 0.3;
if (['pre_launch', 'early_revenue', 'growing'].includes(a('business_stage'))) fit += 0.2;
if (S.flags.no_kb >= 2 && intent === 'SERVICE') fit -= 0.5;
fit = Math.max(0, Math.min(1, Math.max(fit, (S.score.fit || 0) * 0.9)));

const clarity = Number(((c('business_stage') + c('business_type') + c('primary_problem') + c('primary_goal')) / 4).toFixed(2));

let quality = 'Cold';
if (S.flags.vendor_pitch) quality = 'Cold';
else if (it >= 0.70 && fit >= 0.60) quality = 'Hot';
else if (it >= 0.45 && fit >= 0.50) quality = 'Warm';
else if (it >= 0.20 || clarity >= 0.50) quality = 'Exploring';

const prevQuality = S.score.quality;
S.score = { intent: Number(it.toFixed(2)), fit: Number(fit.toFixed(2)), clarity, quality, signals };
S.flags.hot = quality === 'Hot' ? S.flags.hot + 1 : 0;
if (S.phase === 'RECOMMENDING' && ['Warm', 'Hot'].includes(quality)) S.phase = 'QUALIFYING';

// ── handoff ───────────────────────────────────────────────────────────────
// "I want a website" is how a conversation opens, not how it ends. A hire signal on the opening
// turn is interest, not a decision — treating it as one means asking for an email before saying
// anything useful, which is the fastest way to lose the lead. Wait until they have told us
// something, or until the conversation has actually gone somewhere.
let handoff = S.phase === 'HANDOFF' || S.flags.handoff || a('decision_stage') === 'ready';
if (sig.hire && (S.turn >= 2 || (c('business_type') + c('primary_problem')) >= 0.6)) handoff = true;
if (S.flags.hot >= 2 || S.flags.low_conf >= 2 || S.flags.no_kb >= 2) handoff = true;
if (gen.handoff_reason) handoff = true;
// The model set handoff_reason on the opening turn and the visitor got "Book a free consultation"
// under a brochure, before telling us a single thing about their business. Asking to close on turn
// one is asking before answering. Only their own explicit request overrides this.
if (x.narrow_first && intent !== 'HUMAN_REQUEST' && !sig.call && !sig.negotiation) handoff = false;
if (handoff && !['CAPTURING', 'HANDOFF'].includes(S.phase)) S.phase = (S.contact.email || S.flags.declined) ? 'HANDOFF' : 'CAPTURING';
if (S.phase === 'CAPTURING' && S.contact.email) S.phase = 'HANDOFF';

let ask_contact = null;
if (S.phase === 'CAPTURING' && !S.flags.declined) ask_contact = !S.contact.email ? 'email' : (!S.contact.name ? 'name' : null);
// Fetch KB already ruled this out for a narrowing turn, but ask_contact is derived from the phase
// and gets recomputed here — so the email request came back underneath the question anyway. Nobody
// hands over an address before they have been told anything.
if (x.narrow_first) ask_contact = null;

// Asking on every single turn is nagging, and a visitor who did not answer the first time is not
// going to answer the fourth. Ask, then leave it alone for two turns, and give up after three.
S.flags.email_asks = S.flags.email_asks || 0;
S.flags.last_email_ask = S.flags.last_email_ask || 0;
if (ask_contact === 'email') {
  const tooSoon = S.flags.email_asks > 0 && (S.turn - S.flags.last_email_ask) < 3;
  if (S.flags.email_asks >= 3 || tooSoon) ask_contact = null;
  else { S.flags.email_asks += 1; S.flags.last_email_ask = S.turn; }
}

if (ask_contact === 'email' && !/email/i.test(x.reply)) {
  x.reply += "\n\nIf you'd like the team to pick this up with context, what's the best email to reach you — or you can book a time directly.";
}

// ── CTA table (first match wins) ──────────────────────────────────────────
const build = (id) => {
  if (id === 'consult') return { id, label: 'Book a free consultation', url: `${SITE}/start-project`, kind: 'link' };
  if (id === 'pricing') return { id, label: 'See published pricing', url: `${SITE}/pricing`, kind: 'link' };
  if (id.startsWith('service:')) { const s = id.slice(8); return SLUGS.includes(s) ? { id, label: `Explore ${NAMES[s]}`, url: `${SITE}/${s}`, kind: 'link' } : null; }
  if (id === 'tell_more') return { id, label: 'Tell me more about your situation', kind: 'suggest', text: "Here's more detail on my situation: " };
  if (id === 'explore_first') return { id, label: 'Help me explore the options first', kind: 'suggest', text: 'Help me explore the options first' };
  if (id === 'talk_team') return { id, label: 'Talk to the team', kind: 'suggest', text: "I'd like to talk to the team" };
  return null;
};
const shownRecently = (id, n = 1) => S.cta_history.slice(-n).some(h => h.ids.includes(id));
const primary = S.rec[0];
const t = S.turn;
const ids = [];
let reason = 'none';

if (handoff) { ids.push('consult'); if (!S.contact.email && !S.flags.declined && ask_contact !== 'email') ids.push('talk_team'); reason = 'handoff'; }
else if (['PROMPT_INJECTION', 'INTERNAL_INFO', 'ABUSIVE', 'SENSITIVE', 'VENDOR_PITCH'].includes(intent)) reason = 'safe_path';
else if (['UNRELATED', 'GENERAL_KNOWLEDGE'].includes(intent)) { if (S.flags.offtopic >= 3) ids.push('tell_more'); reason = 'unrelated'; }
else if (x.kb_empty && ['COMPANY', 'PRICING', 'SERVICE'].includes(intent)) { ids.push('consult'); reason = 'kb_unavailable'; }
else if (intent === 'PRICING' && x.pricing_mode === 'published') { ids.push('pricing'); if (['Warm', 'Hot'].includes(quality) && !shownRecently('consult')) ids.push('consult'); reason = 'pricing_supported'; }
else if (intent === 'PRICING') { if (!shownRecently('consult')) ids.push('consult'); reason = 'pricing_unknown'; }
else if (quality === 'Hot') { if (!shownRecently('consult')) ids.push('consult'); reason = 'high_intent'; }
else if (quality === 'Warm' && ['RECOMMENDING', 'QUALIFYING'].includes(S.phase)) { ids.push('talk_team'); if (primary && !shownRecently(`service:${primary}`, 2)) ids.push(`service:${primary}`); reason = 'warm_recommendation'; }
else if (S.phase === 'RECOMMENDING' && primary && !shownRecently(`service:${primary}`, 2)) { ids.push(`service:${primary}`); reason = 'service_education'; }
// Once the advisor has answered from the knowledge base AND we know what kind of business this is,
// the visitor has had the useful part. Another "tell me more about your situation" is a third
// question wearing a button, and it is where the conversation quietly ends. Offer the next step.
else if (t >= 2 && !x.fallback && ['SUPPORTED', 'PARTIAL'].includes(x.support) && c('business_type') >= 0.6) {
  ids.push('consult');
  if (primary && !shownRecently(`service:${primary}`, 2)) ids.push(`service:${primary}`);
  reason = 'answered_offer_next_step';
}
else if (clarity < 0.4 && t >= 2) { ids.push('tell_more'); reason = 'insufficient_info'; }
else if (['Cold', 'Exploring'].includes(quality) && t <= 2) reason = 'too_early';
else if (quality === 'Exploring' && t >= 3 && !S.flags.explore_shown) { ids.push('explore_first'); S.flags.explore_shown = true; reason = 'low_intent'; }

const cta = ids.map(build).filter(Boolean).slice(0, 2);
if (cta.length) S.cta_history.push({ t, ids: cta.map(x2 => x2.id), reason });
if (S.cta_history.length > 12) S.cta_history = S.cta_history.slice(-12);

let suggestions = (gen.answer_options || []).filter(s => typeof s === 'string' && s.length <= 60).slice(0, 5);
if (S.phase === 'ADVISORY' && !suggestions.length) suggestions = ['Get our first paying customers', 'Launch a first version', 'Grow revenue from what we have'];
// The model's options are the whole point of the chip row — they are what lets someone answer
// "restaurant" with a tap instead of typing. Append the opt-out, never replace them with it.
if (ask_contact) suggestions = suggestions.concat(["I'd rather book directly"]).slice(0, 5);

if (gen.asked_question) { S.questions.push(gen.asked_question.slice(0, 100)); if (S.questions.length > 8) S.questions = S.questions.slice(-8); }
if (x.fallback) { S.fallbacks = [...(S.fallbacks || []), `t${t}:${x.fallback}`].slice(-8); }

// ── lead write ────────────────────────────────────────────────────────────
const contactJustGiven = !!S.contact.email && S.attrs.email?.t === t;
const debounceOk = !S.last_lead_write || (Date.now() - S.last_lead_write) > 60000;
const lead_write = {
  do: handoff || contactJustGiven || (['Warm', 'Hot'].includes(quality) && debounceOk),
  sync: handoff || contactJustGiven,
  trigger: handoff ? 'handoff' : contactJustGiven ? 'contact' : 'threshold',
};
if (lead_write.do) S.last_lead_write = Date.now();

// ── analytics (no message text) ───────────────────────────────────────────
const events = [{ e: 'message_sent', p: { turn: t, intent, phase: S.phase } }];
if (t === 1) events.push({ e: 'conversation_started', p: { entry: S.entry, quick: x.payload.quick_action_id } });
if (x.docs_used?.length) events.push({ e: 'knowledge_answered', p: { support: x.support, docs: x.docs_used.length } });
if (proposed.length) events.push({ e: 'service_recommended', p: { services: S.rec.concat(S.sec_rec) } });
if (quality === 'Hot' && prevQuality !== 'Hot') events.push({ e: 'high_intent_detected', p: { signals } });
if (cta.length) events.push({ e: 'cta_shown', p: { ids: cta.map(v => v.id), reason } });
if (ask_contact) events.push({ e: 'lead_started', p: { field: ask_contact } });
if (contactJustGiven) events.push({ e: 'lead_completed', p: {} });
if (x.fallback) events.push({ e: 'fallback_triggered', p: { reason: x.fallback } });
if (x.security?.flag) events.push({ e: 'security_flag', p: { families: x.security.families } });

return [{ json: { ...x, S, reply: x.reply, cta, suggestions, ask_contact, handoff, lead_write, events, cta_reason: reason } }];
