// [15] Finalize — Code node (was "Notion Upsert + Respond")
// The lead write now happens in the "Notion · Lead Create" / "Notion · Lead Update" nodes, because
// the Code node cannot reach stored credentials. This node records whether that write landed,
// saves the session server-side, and builds the response body.
// Reached from three branches: after a create, after an update, or straight from "Write lead?" = false.

const ctx = $('Lead Mapper4').first().json;
const S = ctx.S;

// ── 1. did a lead row get written this turn? ──────────────────────────────
// Only one of these nodes runs, and neither runs when lead_write.do was false — so reading a node
// that did not execute throws, and that simply means "no write happened".
let written = null;
for (const name of ['Notion · Lead Create3', 'Notion · Lead Update3']) {
  try {
    const r = $(name).first().json;
    if (r && r.id) { written = String(r.id); break; }
  } catch (e) { /* that branch did not run */ }
}

if (written) {
  S.lead_page_id = written;
  S.flags.lead_ok = true;
  S.flags.lead_failed = false;
} else if (ctx.lead_write?.do) {
  // We meant to write and nothing came back. The reply must not imply a record exists.
  S.flags.lead_ok = false;
  S.flags.lead_failed = true;
  if (ctx.handoff && !/book/i.test(ctx.reply)) {
    ctx.reply += "\n\nYou can also book directly from the site and mention what we discussed.";
  }
}

// ── 2. history, trimmed so stored sessions stay small ──────────────────────
const redact = (s) => String(s)
  .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[number]')
  .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[id]')
  .replace(/\b(\+?\d[\d\s().-]{8,}\d)\b/g, '[phone]')
  .slice(0, 300);

S.history.push({ r: 'u', x: redact(ctx.payload.message) });
S.history.push({ r: 'a', x: String(ctx.reply).slice(0, 300) });
if (S.history.length > 8) S.history = S.history.slice(-8);   // last 4 exchanges

// ── 3. save state server-side; the browser only gets the session id ────────
const store = $getWorkflowStaticData('global');
store.sessions = store.sessions || {};
store.sessions[S.sid] = { t: Date.now(), s: S };

const response = {
  state_token: S.sid,
  reply: ctx.reply,
  cta: ctx.cta,
  suggestions: ctx.suggestions,
  state: { phase: S.phase, handoff: !!ctx.handoff, ask_contact: ctx.ask_contact || null, closing: !!S.flags.closing },
};

// Leak guard: internal vocabulary must never reach the browser.
if (/"score"|lead_quality|kb_context|system prompt|notion|n8n/i.test(JSON.stringify({ ...response, state_token: '' }))) {
  throw new Error('response leak guard tripped');
}

// Cache the reply against the turn id so a retry after a timeout costs nothing.
store.seen = store.seen || {};
store.seen[ctx.seen_key] = { t: Date.now(), r: response };

return [{ json: { response, events: ctx.events, sid: S.sid, lead_written: !!S.flags.lead_ok } }];
