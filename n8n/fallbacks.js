// [11] Safe replies + fallbacks — Code node
// Every path converges here: safe intents that skipped the advisor call, validated replies, and
// failures. None of these may hint at how the advisor works, and none may be a dead end — every
// one gives the visitor something and a way forward.

const x = $input.first().json;
const S = x.S;
const intent = x.intent;
const a = (k) => S.attrs[k]?.v || null;
const pick = (arr) => arr[S.turn % arr.length];

const T = {
  PROMPT_INJECTION: pick([
    "I can help with what Simplified Startup does and whether the team is a fit for your business, but not with anything behind the scenes.\n\nWhat are you working on?",
    "That's not something I can get into. What I can do is help you work out which kind of support fits your situation — tell me what's on your plate.",
  ]),
  INTERNAL_INFO: pick([
    "I can't get into how things work behind the scenes, but I can tell you what the team takes on and what a sensible next step looks like.\n\nWhat are you trying to achieve?",
    "That's not something I can detail. Tell me what you're trying to build or fix, and I'll tell you where Simplified Startup fits — and where it doesn't.",
  ]),
  UNRELATED: pick([
    "I'm focused on startup strategy, growth, product, web, marketing, sales and automation.\n\nIf there's a business problem behind this, tell me what's stuck and I'll help you think it through.",
    "That's outside what I'm here for. I'm best on building, launching and growing a business — what are you working on?",
  ]),
  GENERAL_KNOWLEDGE: "I'm not the right place for that one. I'm here for startup strategy, growth, product, web, marketing, sales and automation — if there's a business question underneath it, I'm glad to take that on.",
  ABUSIVE: "I'll stay on the business side of things. If there's something you're trying to build or grow, I'm here for that.",
  VENDOR_PITCH: "Thanks for reaching out. I'm set up to help founders exploring Simplified Startup's services rather than partnerships or vendor offers — the contact email on the website is the right place for that.",
  SENSITIVE: "I'm sorry you're dealing with that. It's outside what I should advise on — a qualified professional, or a person on the team if it concerns Simplified Startup directly, is the right next step.\n\nIf it's useful, I'm still here for the business side.",
  CLOSING: "I'm best at startup strategy, growth, product, web, marketing, sales and automation, so I'll leave it there. If a business question comes up, come back any time — or book a conversation with the team from the site.",
  HUMAN_REQUEST: S.contact.email
    ? "Understood. You can book a time with the team directly, and they'll have the context from this conversation."
    : "Of course. The team is the right next step for this. What's the best email for them to reach you — or you can book a time directly.",
  PRICING_UNKNOWN: (() => {
    const svc = a('requested_service')?.replace(/-/g, ' ');
    return `Pricing${svc ? ` for ${svc}` : ''} comes down to scope and which part of the team is involved, and I'd rather not give you a number that turns out to be wrong.\n\nWhat usually moves it most is how much already exists versus how much is built from scratch. Tell me a bit about what you're starting from and I can show you which kind of engagement you're looking at — and the team scopes it properly in writing.`;
  })(),
  KB_EMPTY: "I don't have that one confirmed, and I'd rather say so than guess.\n\nI can still help you think it through — what's driving the question? If it's a decision you're weighing, I can usually tell you what actually changes the answer.",
  UNGROUNDED: "I don't have enough to answer that accurately, and a confident wrong answer is worse than none.\n\nTell me a little more about what you're trying to achieve and I can point you in the right direction — or the team can answer it directly.",
  NARROW: "Before pointing you anywhere, Simplified Startup starts with who the work is actually for. It is the thing that changes everything else — what earns trust for a restaurant is usually the wrong first move for a B2B software company, and building before that is settled is how most of the budget gets spent twice.\n\nWhat kind of business is this for?",
  LLM_FAILURE: "I lost the thread on that one. Could you say it another way, or tell me a bit more about what you're trying to achieve?",
  BROKEN: "Let me keep this simple: tell me the one thing that's most stuck right now, and I'll help you work out where to start.",
};

let reply = null, fallback = null, fbOptions = [];

if (S.flags.closing && ['UNRELATED', 'GENERAL_KNOWLEDGE'].includes(intent)) { reply = T.CLOSING; fallback = 'closing'; }
else if (x.route === 'safe' && T[intent]) { reply = T[intent]; fallback = intent.toLowerCase(); }
else if (intent === 'HUMAN_REQUEST' && !x.gen) { reply = T.HUMAN_REQUEST; fallback = 'human_request'; }
else if (x.ok && x.gen?.reply) { reply = x.gen.reply; }
else {
  const r = x.fallback_reason || 'unknown';
  if (x.kb_empty && ['COMPANY', 'SERVICE', 'PRICING', 'BUYING_INTENT'].includes(intent)) { reply = T.KB_EMPTY; fallback = 'kb_empty'; }
  else if (r === 'narrow_incomplete') {
    reply = T.NARROW;
    fallback = 'narrow_incomplete';
    // The chip row is the point of a narrowing turn, and this path exists precisely because the
    // model returned none. The question above is fixed, so fixed answers to it are the right ones.
    fbOptions = ['Shop or e-commerce', 'Restaurant or hospitality', 'Clinic or healthcare', 'Services or consulting', 'Something else'];
  }
  else if (intent === 'PRICING' || r === 'invented_price') { reply = T.PRICING_UNKNOWN; fallback = 'pricing_unknown'; }
  else if (['unsupported_claim', 'added_specificity', 'internal_leak', 'url_in_reply', 'fake_action', 'pressure', 'unprompted_pricing'].includes(r)) { reply = T.UNGROUNDED; fallback = 'ungrounded:' + r; }
  else if (['invalid_json', 'llm_failure'].includes(r)) { reply = T.LLM_FAILURE; fallback = 'llm_failure'; }
  else if (['too_long', 'too_short', 'too_many_questions'].includes(r)) { reply = T.BROKEN; fallback = r; }
  else { reply = T.UNGROUNDED; fallback = 'unknown:' + r; }
}

const gen = (x.gen && !fallback) ? x.gen : {
  reply, cta_intent: 'none', asked_question: null, answer_options: fbOptions, claims: [], uses_pricing: false,
  handoff_reason: intent === 'HUMAN_REQUEST' ? 'explicit_request' : (fallback === 'kb_empty' || String(fallback).startsWith('ungrounded') ? 'no_kb' : null),
  recommended_services: [], confidence: fallback ? 0.3 : 0.6,
};

S.flags.low_conf = (fallback || gen.confidence < 0.4) ? S.flags.low_conf + 1 : 0;

return [{ json: { ...x, S, reply, gen, fallback } }];
