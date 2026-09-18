// [10] Validate the generated reply — Code node
// Deterministic only. No extra LLM call: the router already narrowed the context, so what is left
// to check is mechanical — invented prices, internal vocabulary, URLs, fake actions, pressure,
// length, one-question rule.

const ctx = $('Fetch KB4').first().json;

// No output-parser sub-node, so the reply arrives as plain text in `.text`. Same tolerant parse as
// Merge State: a ```json fence, a sentence before the object or a trailing comma all still work.
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
let gen = parseJson(raw.output ?? raw.text ?? raw.response ?? raw);

const fail = (reason) => [{ json: { ...ctx, gen: gen || {}, ok: false, fallback_reason: reason } }];

// Sometimes the model forgets the envelope and answers in plain prose. The ANSWER is usually fine —
// throwing it away and showing "I lost the thread on that one" punishes the visitor for a
// formatting slip. If what came back reads like a reply rather than a broken object, keep it and
// let every check below judge it exactly as it would judge a parsed one.
if (!gen || typeof gen.reply !== 'string') {
  const prose = String(raw.output ?? raw.text ?? raw.response ?? '').trim();
  if (prose && !prose.includes('{') && prose.length >= 40 && prose.length <= 2000) {
    gen = { reply: prose, cta_intent: 'none', asked_question: null, answer_options: [], claims: [],
            handoff_reason: null, recommended_services: [], confidence: 0.5, _salvaged: true };
  } else {
    return fail('invalid_json');
  }
}

// A narrowing turn has a contract: a question, and options they can tap. The model sometimes
// returns only the observation — "you mentioned wanting a website but haven't shared what type" —
// with asked_question null and answer_options empty. That is a dead end that blames the visitor
// for the model's own missing turn, so it never ships.
if (ctx.narrow_first && (!gen.asked_question || !Array.isArray(gen.answer_options) || gen.answer_options.length < 3)) {
  return fail('narrow_incomplete');
}
// "You want a website, which is a great start. What kind of business is it for?" asks the right
// thing and gives the visitor nothing: it restates their message and stops. A narrowing turn is
// short, not empty — it still has to say why the answer depends on what it is asking.
if (ctx.narrow_first && gen.reply.trim().length < 180) return fail('narrow_incomplete');

let reply = gen.reply.trim();

// strip sycophancy rather than failing the whole turn
reply = reply.replace(/^(absolutely|certainly|great question|that's an excellent question|great choice|sure)[!.,]?\s*(—|-)?\s*/i, '');
reply = reply.replace(/\bI'd be (thrilled|delighted|happy) to\b/gi, 'I can');

// Answering two or three questions legitimately needs more room than answering one.
const asked = (ctx.questions || []).length;
const maxLen = asked >= 2 ? 1500 : 1200;
const maxParas = asked >= 2 ? 6 : 5;

if (reply.length < 20) return fail('too_short');
if (reply.length > maxLen || reply.split(/\n\s*\n/).length > maxParas) return fail('too_long');
if ((reply.match(/\?/g) || []).length > 1) return fail('too_many_questions');
if (/https?:\/\/|www\.|\[[^\]]+\]\([^)]+\)|<[a-z][^>]*>/i.test(reply)) return fail('url_in_reply');

// Internal vocabulary must never surface — but ONLY genuinely internal vocabulary.
// Words like workflow, automation, database, API and integration are the company's own product
// language ("workflow audit" is a named step of the AI Automation service), so banning them
// rejects perfectly good answers. What must never appear is the advisor talking about ITSELF:
// its prompt, its retrieval, its vendors, or the act of looking something up.
const LEAKS = [
  /\bsystem prompt\b/i,
  /\bmy (instructions|guidelines|prompt|training|configuration|rules)\b/i,
  /\bknowledge base\b/i,
  /\b(n8n|notion|openai|anthropic|langchain|groq)\b/i,
  /\bgpt-?\d/i,
  /\b(claude|llm|large language model|language model)\b/i,
  /\b(vector (database|store)|embeddings?|retrieval[- ]augmented|rag)\b/i,
  /\b(the|my) (documents?|context|data|records|files) (I|i) (have|was given|can see)\b/i,
  /\bin my (data|records|files|context)\b/i,
  /\bi (looked|searched|checked) (this|that|it) up\b/i,
  /\b(based on|according to) (the|my) (documents?|context|data|knowledge)\b/i,
];
for (const p of LEAKS) if (p.test(reply)) return fail('internal_leak');

// actions the system cannot perform, and promises nobody authorised
// An adverb slips in more often than not — "I have already emailed you" — so allow a word or two
// between the verb phrase and the action.
if (/\b(I('ve| have)( \w+){0,2} (sent|emailed|forwarded|booked|scheduled|notified|passed (this|it) (on|along))|someone( \w+){0,4} will (contact|call|email|reach out)|the team (has|have)( \w+){0,2} (reviewed|seen|read)|I('ll| will)( \w+){0,2} (send|email|book|schedule|forward))\b/i.test(reply) && !ctx.S.flags.lead_ok) return fail('fake_action');
if (/\bwithin (\d+|one|two|a few|24|48)\s*(hours?|days?|business days?)\b/i.test(reply)) return fail('fake_action');
// "we can send you a plan" is the same broken promise in the first person plural — nothing is sent.
// But a good answer that ends with one unkeepable sentence should lose the sentence, not the answer:
// throwing the whole turn away costs the visitor three useful paragraphs to save them one bad line.
// Strip it; only fail if too little survives to be worth sending.
// "I can connect you with the team" is the same unkeepable promise as "I can send you a plan" —
// nothing connects anyone, and the visitor then waits for an introduction that never comes. The
// verb list is what makes or breaks this guard, so it covers the whole family, not just sending.
const PROMISE = /[^.!?\n]*\b(we|i|let\s+me|let\s+us)\s*('ll|'d| can| could| will| would)?\s*(send|email|share|put together|prepare|draft|deliver|connect|introduce|arrange|refer|hand|pass|set up|get)\s+(you|over|a|an|the|it|us)\b[^.!?\n]*[.!?]?/gi;
if (PROMISE.test(reply)) {
  const stripped = reply.replace(PROMISE, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/\(\s*\)/g, '').trim();
  if (stripped.length >= 120) {
    reply = stripped;
    // The question it asked was probably the promise itself; do not keep it in state.
    if (gen.asked_question && /\b(send|email|share|prepare)\b/i.test(gen.asked_question)) gen.asked_question = null;
  } else {
    return fail('fake_action');
  }
}

// Pricing talk the visitor never asked for reads as defensive and points at the hidden number.
const askedMoney = /\b(cost|price|pricing|charge|budget|fee|rate|expensive|afford|how much)\b/i
  .test([ctx.payload.message, ...(ctx.questions || [])].join(' '));
if (!askedMoney && /\b(pricing (is|isn't|is not)|not published|exact price|price is set|scope of work is defined|free growth plan)\b/i.test(reply)) return fail('unprompted_pricing');

if (/\b(act now|limited (time|spots?)|only (a )?few (spots|places)|don't miss out|you('re| are) missing out|last chance|hurry|best option for you)\b/i.test(reply)) return fail('pressure');

// ── pricing: every amount must appear in a pricing-allowed doc that was actually fetched ──
const allowed = new Set(ctx.allowed_prices || []);
const amounts = [];
for (const m of reply.matchAll(/(?:\$|usd\s?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)(\s*k\b)?/gi)) {
  const n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  amounts.push(String(Math.round(n)));
}
const percents = (reply.match(/(\d{1,3})\s?%/g) || []).map(p => p.replace(/\s/g, '').replace('%', '') + '%');
if (amounts.length && ctx.pricing_mode !== 'published') return fail('invented_price');
for (const v of amounts) if (!allowed.has(v)) return fail('invented_price');
for (const p of percents) if (!allowed.has(p)) return fail('invented_price');

// ── grounding: company claims require context ──
let claims = Array.isArray(gen.claims) ? gen.claims.slice(0, 8) : [];
// A narrowing turn states no company facts — it asks a question. But we also require it to name
// Simplified Startup, and the model files that sentence as a claim, which the gate below then
// rejects for having no supporting document. That is how a good turn became "I don't have enough
// to answer that accurately". Naming who is speaking is not a claim about the work; a promise
// about what the work involves still is, so that is what gets checked here instead.
// This only matters when NOTHING was retrieved. With documents in hand the gate below does the
// real work, and blocking the word "offers" here rejected "Simplified Startup offers fast, modern
// websites" — the company naming the prompt asks for — and sent a good narrowing turn to the
// fallback. Unsupported, what must not appear is a concrete promise about the work itself.
if (ctx.narrow_first && ctx.support === 'NOT_SUPPORTED') {
  if (/\b(we|our team|simplified startup)\b[^.!?]{0,60}\b(includes?|guarantees?|delivers?)\b/i.test(reply)) return fail('narrow_incomplete');
  if (/\b\d+\s*(day|week|month|year)s?\b/i.test(reply)) return fail('narrow_incomplete');
  claims = [];
}
if (ctx.support === 'NOT_SUPPORTED' && claims.length > 0) return fail('unsupported_claim');
if (ctx.support === 'NOT_SUPPORTED' && /\b(simplified startup|our team|we)\b.{0,40}\b(typically|usually|often|around|about|most clients|guarantee)\b/i.test(reply)) return fail('unsupported_claim');
// A claim naming a figure or timeframe must have that string somewhere in the fetched docs.
for (const claim of claims) {
  const facts = claim.match(/\b\d+[\d,.%]*\s*(weeks?|days?|months?|years?|%)?\b/gi) || [];
  for (const f of facts) {
    const bare = f.trim().replace(/,/g, '');
    if (bare.length < 2) continue;
    if (!ctx.kb_context.replace(/,/g, '').toLowerCase().includes(bare.toLowerCase())) return fail('added_specificity');
  }
}

if (!ctx.allowed_cta.includes(gen.cta_intent)) gen.cta_intent = 'none';
gen.reply = reply;
gen.claims = claims;
gen.answer_options = Array.isArray(gen.answer_options) ? gen.answer_options.slice(0, 5) : [];
gen.recommended_services = Array.isArray(gen.recommended_services) ? gen.recommended_services.slice(0, 3) : [];
if (typeof gen.confidence !== 'number') gen.confidence = 0.5;

return [{ json: { ...ctx, gen, ok: true, fallback_reason: null } }];
