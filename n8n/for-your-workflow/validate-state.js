// [2] Validate request + load state + rate limit — Code node, "Run Once for All Items"
// Runs on n8n Cloud: no require(), no $env, no Web Crypto.
// Conversation state lives server-side in workflow static data. The browser only ever holds an opaque
// session id, so internal scoring and flags never leave the server.
// Upstream node: Crypto (Generate → HEX, length 32, property name "sid_new").

const SITE = 'https://simplifiedstartup.com';

// Remove the two local entries before going live.
const ALLOWED_ORIGINS = [SITE, 'http://localhost', 'http://127.0.0.1'];

const SESSION_TTL_MS = 24 * 3600 * 1000;
const MAX_SESSIONS = 500;
const MAX_MSG = 1500;
const LIMITS = { per_min: 12, per_hour: 60 };

const reject = (status, code, retryAfter) => [{ json: { ok: false, status, error: { code, retryable: status === 429 || status >= 500, ...(retryAfter ? { retry_after: retryAfter } : {}) } } }];

// ── read body ──────────────────────────────────────────────────────────────
const item = $input.first().json;
const headers = item.headers || {};
let body = item.body;
if (typeof body === 'string') {
  if (body.length > 16384) return reject(400, 'bad_request');
  try { body = JSON.parse(body); } catch { return reject(400, 'bad_request'); }
}
if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(400, 'bad_request');

// ── origin allowlist ───────────────────────────────────────────────────────
const origin = String(headers.origin || headers.referer || '').replace(/\/$/, '');
if (origin && !ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return reject(400, 'bad_request');

// Rate-limit bucket key. FNV-1a, not a cryptographic hash — it only has to spread IPs across buckets
// and keep the raw address out of stored data. A collision just merges two buckets.
const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};
const ipRaw = String(headers['cf-connecting-ip'] || headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0] || '').trim();
const ipHash = fnv(ipRaw) + fnv(ipRaw + '#2') + fnv('#3' + ipRaw);

// ── static data: sessions, rate limits, idempotency ────────────────────────
const store = $getWorkflowStaticData('global');
store.sessions = store.sessions || {};
store.rate = store.rate || {};
store.seen = store.seen || {};

const now = Date.now();
const nowMin = Math.floor(now / 60000);
for (const k of Object.keys(store.rate)) if (nowMin - store.rate[k].m > 60) delete store.rate[k];
for (const k of Object.keys(store.seen)) if (now - store.seen[k].t > 3600000) delete store.seen[k];
for (const k of Object.keys(store.sessions)) if (now - store.sessions[k].t > SESSION_TTL_MS) delete store.sessions[k];

// hard cap so static data can't grow without bound: drop the least recently used
const sessKeys = Object.keys(store.sessions);
if (sessKeys.length > MAX_SESSIONS) {
  sessKeys.sort((a, b) => store.sessions[a].t - store.sessions[b].t);
  for (const k of sessKeys.slice(0, sessKeys.length - MAX_SESSIONS)) delete store.sessions[k];
}

// ── session id ─────────────────────────────────────────────────────────────
// Must be unguessable: it is the only thing standing between a visitor and someone else's
// conversation. Math.random alone is not enough — V8's PRNG is predictable from its own output,
// so a visitor who sees their own id could work out other visitors' ids.
// The strong ingredient is the browser's turn_client_id: the widget derives it from
// crypto.randomUUID(), giving 96 bits an attacker has no way to know. Server-side values are
// mixed in so the id still holds up if an old browser fell back to Math.random().
const mix = (seed) => {
  let out = '';
  for (let i = 0; i < 4; i++) {
    let h = (0x811c9dc5 ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    const s = seed + '|' + i;
    for (let j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
};
let execId = '';
try { execId = String($execution?.id || ''); } catch (e) {}
const baseSeed = [
  String(body.turn_client_id || ''),
  execId, now, ipRaw,
  String(headers['user-agent'] || ''),
  Math.random(), Math.random(), Math.random(),
].join('|');

let sidNew = mix(baseSeed);
for (let n = 0; store.sessions[sidNew] && n < 8; n++) sidNew = mix(baseSeed + '|retry' + n + Math.random());

const newState = () => ({
  sid: sidNew,
  phase: 'DIAGNOSING',
  turn: 0,
  attrs: {},
  contact: { name: null, email: null, company: null },
  rec: [], sec_rec: [],
  score: { intent: 0, fit: 0, clarity: 0, quality: 'Cold' },
  flags: { security_hits: 0, offtopic: 0, abusive: 0, handoff: false, pricing_asked: false, declined: false, low_conf: 0, no_kb: 0, hot: 0, explore_shown: false, closing: false, lead_ok: false },
  cta_history: [], questions: [], history: [],
  lead_page_id: null, last_lead_write: null,
  entry: '', created_at: new Date().toISOString(),
});

// state_token is just the session id — an opaque handle, nothing readable in it.
let S = null, isNew = false;
const tok = typeof body.state_token === 'string' ? body.state_token : '';
if (/^[a-f0-9]{32,64}$/i.test(tok)) {
  const rec = store.sessions[tok];
  if (rec && now - rec.t < SESSION_TTL_MS && rec.s && rec.s.sid) S = rec.s;
}
if (!S) { S = newState(); isNew = true; }

// ── rate limit ─────────────────────────────────────────────────────────────
const bucket = store.rate[ipHash] || (store.rate[ipHash] = { m: nowMin, min: 0, hour: 0, h: nowMin });
if (nowMin !== bucket.m) { bucket.m = nowMin; bucket.min = 0; }
if (nowMin - bucket.h >= 60) { bucket.h = nowMin; bucket.hour = 0; }
bucket.min += 1; bucket.hour += 1;
if (bucket.min > LIMITS.per_min) return reject(429, 'rate_limited', 30);
if (bucket.hour > LIMITS.per_hour) return reject(429, 'rate_limited', 300);
if (S.flags.muted_until && now < S.flags.muted_until) return reject(429, 'rate_limited', 600);

// ── event beacons short-circuit ────────────────────────────────────────────
const ALLOWED_EVENTS = new Set(['chat_opened', 'quick_action_clicked', 'cta_clicked', 'conversation_reset']);
if (body.type === 'event') {
  const ev = String(body.event || '');
  if (!ALLOWED_EVENTS.has(ev)) return reject(400, 'bad_request');
  return [{ json: { ok: true, kind: 'event', event: ev, sid: S.sid, props: { cta_id: String(body.props?.cta_id || '').slice(0, 60), quick_action_id: String(body.props?.quick_action_id || '').slice(0, 40) } } }];
}

// ── message ────────────────────────────────────────────────────────────────
let message = typeof body.message === 'string' ? body.message.replace(/\u0000/g, '').trim() : '';
if (!message) return reject(400, 'bad_request');
if (message.length > MAX_MSG) return reject(400, 'message_too_long');
message = message.replace(/\s{3,}/g, '  ').replace(/(.)\1{20,}/g, '$1$1$1');

// Contact details must never depend on the model. In testing the visitor typed their email, the
// advisor call was throttled that turn, and the address was lost — the one turn that was actually
// converting. A regex here runs before any model call and cannot fail, so an email that was
// literally handed over is always captured. Merge State still records it as an attribute for
// scoring; this is the floor beneath that, not a replacement.
const typedEmail = message.match(/[^\s@,;<>()[\]]+@[^\s@,;<>()[\]]+\.[a-z]{2,}/i);
if (typedEmail && !S.contact.email) S.contact.email = typedEmail[0].toLowerCase().replace(/[.,;:]+$/, '');

// duplicate turn → replay the stored reply, no LLM calls
const tid = typeof body.turn_client_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.turn_client_id)
  ? body.turn_client_id
  : 't_' + sidNew.slice(0, 16) + now.toString(36);
const seenKey = S.sid + ':' + tid;
if (store.seen[seenKey]) {
  return [{ json: { ok: true, kind: 'cached', cached: store.seen[seenKey].r } }];
}

const c = body.client || {};
const page_url = typeof c.page_url === 'string' && c.page_url.startsWith(SITE) ? c.page_url.slice(0, 300) : SITE;
if (isNew) S.entry = page_url;

return [{
  json: {
    ok: true,
    kind: 'message',
    S,
    is_new: isNew,
    ip_hash: ipHash,
    seen_key: seenKey,
    payload: {
      message,
      turn_client_id: tid,
      quick_action_id: typeof body.quick_action_id === 'string' && /^[a-z_]{2,40}$/.test(body.quick_action_id) ? body.quick_action_id : null,
      page_url,
      device: c.device === 'mobile' ? 'mobile' : 'desktop',
    },
  },
}];
