// Advisor call errored or returned nothing parseable — hand the fallback node a reason.
const ctx = $('Fetch KB4').first().json;
return [{ json: { ...ctx, gen: null, ok: false, fallback_reason: 'llm_failure' } }];
