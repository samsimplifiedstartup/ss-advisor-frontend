// [14] Lead mapper — Code node
// Builds the Advisor Leads row from conversation STATE, not the transcript.
// Output is a FLAT `lead` object; the "Notion · Lead Create/Update" nodes map each key to a
// Notion property, so the names below must match the database exactly (docs/03-notion-schema.md).

const x = $input.first().json;
const S = x.S;
const a = (k) => S.attrs[k]?.v || null;

const NAMES = {
  'digital-marketing': 'Digital Marketing', 'website-development': 'Website Development', 'branding-growth': 'Branding & Growth',
  'sales-lead-gen': 'Sales & Lead Generation', 'ai-automation': 'AI Automation', 'business-advisory': 'Business & Startup Advisory',
  'talent-staffing': 'Talent & Staffing', 'bookkeeping': 'Bookkeeping & Accounting',
};
const STAGE = { idea: 'Idea', pre_launch: 'Pre-launch', early_revenue: 'Early revenue', growing: 'Growing', established: 'Established' };
const TIME = { asap: 'ASAP', '1_3_months': '1-3 months', '3_6_months': '3-6 months', '6_plus': '6+ months' };

let status = 'New';
if (S.flags.vendor_pitch) status = 'Not Qualified';
else if (S.flags.handoff || S.phase === 'HANDOFF') status = 'Human Requested';
else if (S.score.quality === 'Hot' || (S.score.quality === 'Warm' && S.contact.email)) status = 'Qualified';
else if (S.flags.low_conf >= 2 || S.flags.no_kb >= 2) status = 'Needs Review';

const primary = S.rec[0];
const who = [a('team_size') ? `${a('team_size')}-person` : null, a('business_type') || 'startup'].filter(Boolean).join(' ');
const stage = STAGE[a('business_stage')] ? ` at ${STAGE[a('business_stage')].toLowerCase()} stage` : '';
const ds = a('decision_stage');
const summary = [
  `${who.charAt(0).toUpperCase() + who.slice(1)}${stage}.`,
  a('primary_problem') ? ` Problem: ${a('primary_problem')}.` : '',
  a('primary_goal') ? ` Goal: ${a('primary_goal')}${a('timeline') ? ` within ${TIME[a('timeline')] || a('timeline')}` : ''}.` : '',
  ds ? ` Visitor is ${ds === 'ready' ? 'ready to start' : ds === 'comparing' ? 'comparing providers' : 'exploring options'}${S.flags.handoff ? ' and asked to speak with the team' : ''}.` : (S.flags.handoff ? ' Visitor asked to speak with the team.' : ''),
  primary ? ` Most relevant: ${NAMES[primary]}${S.sec_rec.length ? ` with ${S.sec_rec.map(s => NAMES[s]).join(', ')}` : ''}${S.reasoning ? ` — ${S.reasoning}` : ''}.` : '',
  S.flags.pricing_asked ? ' Asked about pricing.' : '',
].join('').slice(0, 1900);

let nba = 'Review summary; no follow-up unless contact was provided.';
if (status === 'Human Requested') nba = 'Reply within one business day — the visitor asked for a person. Offer the free growth plan conversation.';
else if (status === 'Qualified') nba = `Reach out and propose a growth-plan call focused on ${primary ? NAMES[primary] : 'the described problem'}.`;
else if (status === 'Needs Review') nba = 'The advisor could not answer confidently — check for a knowledge-base gap, then follow up if contact exists.';

const notes = [
  `Understood: ${who}${stage}. Problem: ${a('primary_problem') || '—'}. Goal: ${a('primary_goal') || '—'}.`,
  `Recommended: ${primary ? NAMES[primary] : '—'}${S.sec_rec.length ? ' + ' + S.sec_rec.map(s => NAMES[s]).join(', ') : ''}. Why: ${S.reasoning || '—'}`,
  `KB entries used this turn: ${(x.docs_used || []).join(', ') || 'none'} (support ${x.support}).`,
  `CTA: ${(S.cta_history.slice(-4).map(h => `t${h.t}:${h.ids.join('+')}(${h.reason})`).join('; ')) || 'none'}.`,
  `Scores — intent ${S.score.intent}, fit ${S.score.fit}, clarity ${S.score.clarity} → ${S.score.quality}. Signals: ${(S.score.signals || []).join(', ') || '—'}.`,
  `Fallbacks: ${(S.fallbacks || []).join(', ') || 'none'}. Security flags: ${S.flags.security_hits}.`,
  `Entry page: ${S.entry}. Device: ${x.payload.device}. Trigger: ${x.lead_write.trigger}. Turns: ${S.turn}.`,
].join('\n').slice(0, 1900);

const lastUser = [...S.history].reverse().find(h => h.r === 'u')?.x || x.payload.message;

// Text properties get '' rather than null: the Notion node always sends every mapped property,
// and an empty rich_text is valid. Email and Website must be null when unknown — Notion rejects
// an empty string for those two types.
const t = (v) => (v == null ? '' : String(v));

const lead = {
  'Lead': `${S.contact.company || a('business_type') || 'Startup'} — ${a('primary_problem') || a('primary_goal') || 'advisor conversation'}`.slice(0, 80),
  'Conversation ID': S.sid,
  'Status': status,
  'Intent level': S.score.quality,
  'Visitor name': t(S.contact.name),
  'Email': S.contact.email || null,
  'Company': t(S.contact.company),
  'Website': a('website') || null,
  'Business stage': STAGE[a('business_stage')] || 'Unknown',
  'Business type': t(a('business_type')),
  'Primary problem': t(a('primary_problem')),
  'Primary goal': t(a('primary_goal')),
  'Recommended service': primary ? NAMES[primary] : 'Unclear',
  'Secondary services': S.sec_rec.map(s => NAMES[s]),
  'Timeline': TIME[a('timeline')] || 'Unknown',
  'Lead summary': summary,
  'Next best action': nba,
  'Last user message': String(lastUser).slice(0, 300),
  'Source': 'AI Advisor',
  'First seen': S.created_at,
  'Last activity': new Date().toISOString(),
  'Turns': S.turn,
  'Internal notes': notes,
};

return [{ json: { ...x, lead, lead_status: status, lead_page_id: S.lead_page_id } }];
