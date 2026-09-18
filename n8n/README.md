# AI Advisor — n8n workflow

**`SS-AI-Advisor.workflow.json`** is a full export, kept as a record of how the pieces fit together.

In practice nothing is imported: importing replaces the Notion and OpenAI credentials, which then have
to be set up again. Instead the files in **`for-your-workflow/`** are pasted into the matching Code
nodes — they are the same sources with the node names this instance actually uses (`Fetch KB4`,
`Merge State4`, `Notion · Lead Create3` and so on).

## Why it was restructured

Three things the Code node cannot do on this instance, each confirmed by an actual error:

| Attempt | Result |
|---|---|
| `require('crypto')` | `Module 'crypto' is disallowed` — needs `NODE_FUNCTION_ALLOW_BUILTIN`, self-hosted env only |
| `globalThis.crypto` (Web Crypto) | not exposed in the task-runner sandbox |
| `this.helpers.httpRequestWithAuthentication` | `not supported in the Code Node` |

So: no encryption, no env vars, and no Notion calls from Code nodes.

- **State** moved server-side into `$getWorkflowStaticData('global').sessions`. The browser holds
  only an opaque session id. Internal scoring and flags never leave the server — better than
  encrypting them and shipping them out.
- **Notion** moved into four real Notion nodes.
- **Config** is plain constants at the top of each Code node. No `$env` anywhere.

## How retrieval works

The router never picks individual KB entries. It picks **categories**, and the category list is
built from the Notion database on every request:

```
Notion · KB Query  → every approved, public entry
KB Index           → derives categories from what the entries actually contain:
                     area:<Service tags>   and   kind:<Type>
Router (AI)        → reads that list, names at most 3 categories
Merge State        → every entry under those categories becomes a candidate,
                     ranked, then capped at 6 pages / 18k chars
Notion · KB Page   → fetches the full body of each
Advisor (AI)       → answers from that content
```

Nothing in the workflow has a category hard-coded. Add an entry in Notion, or a whole new service
tag, and it appears in the router's list on the next message — no workflow edit, no redeploy. An
invented category that isn't in the database is dropped before it can be used.

Tested against the 23 seeded entries:

```
categories derived: 17     (10 areas + 7 kinds, counts from the data)

"what does a website cost?"        → website-development + Pricing
   Pricing — Standalone SEO, brand and web rates
   Pricing — Monthly marketing packages
   Pricing — Bundles and discounts
   FAQ — how fast can we launch
   Service — Website Development          … 6 pages, priced entries ranked first

"do you do SEO, and how fast can you launch a site?"   → two categories, both covered
invented category + a real one      → only the real one resolves
no category chosen                  → 0 pages (diagnostic reply, no KB needed)
broadest category                   → capped at 6
```

## More than one question per message

A visitor rarely asks exactly one thing. The router splits the message into `questions[]` (up to
three), the advisor receives them numbered and is told to answer every one in order, and the output
validator allows a longer reply when two or more were asked. Dropping the second question because
the first was easier is a specific thing the prompt forbids.

## Never a dead end, never a word about the setup

The advisor is told it always owes the visitor something: if the knowledge base doesn't cover the
question, say so in one plain sentence, then give what can be given — how the decision is usually
approached, what would change the answer, what to look at first — and offer the next step.

Nothing may reveal how the advisor works. The prompt bans mentioning prompts, categories, databases,
retrieval, models or lookups, and bans tell-tale phrasing like "my knowledge base" or "I don't have
that in my data" in favour of "I don't have that confirmed". `validate-output.js` enforces it: a
reply containing that vocabulary is rejected and a clean fallback goes out instead.

The next step is earned rather than pushed — answer first, no scarcity or urgency language, and the
CTA only when it follows naturally from what was just said. A visitor who is only reading should
still leave with something worth having.

## Nodes

| File | Node |
|---|---|
| `validate-state.js` | Validate + State |
| `kb-index.js` | KB Index (builds the category catalog) |
| `merge-state.js` | Merge State (resolves categories → pages) |
| `split-kb-ids.js` | Split KB Ids |
| `fetch-kb.js` | Fetch KB |
| `validate-output.js` | Validate Output |
| `fallbacks.js` | Fallbacks |
| `qualify-cta.js` | Qualify + CTA |
| `lead-mapper.js` | Lead Mapper |
| `finalize.js` | Finalize (was "Notion Upsert + Respond") |
| `prompts/router.txt` | Router (System Message) |
| `prompts/advisor.txt` + `advisor-user.txt` | Advisor |

## No structured-output parser

The `outputParserStructured` sub-nodes are gone — they need a paid n8n plan, and on this account the
Router came back as an empty item because of it.

Instead each prompt ends with the exact JSON object it must return, and `merge-state.js` /
`validate-output.js` parse the model's text themselves. The parse is deliberately tolerant, because
models do all of this in practice:

```
  PASS  clean object (parser-style)   parsed → PRICING, 2 pages
  PASS  plain text JSON               parsed → PRICING, 2 pages
  PASS  ```json fenced                parsed → PRICING, 2 pages
  PASS  bare ``` fenced               parsed → PRICING, 2 pages
  PASS  preamble before JSON          parsed → PRICING, 2 pages
  PASS  preamble and trailing note    parsed → PRICING, 2 pages
  PASS  trailing comma                parsed → PRICING, 2 pages
  PASS  single line, no spaces        parsed → PRICING, 2 pages
  PASS  model refused / prose only    unparseable → safe GENERAL fallback
  PASS  empty string                  unparseable → safe GENERAL fallback
  PASS  empty item (the bug you hit)  unparseable → safe GENERAL fallback
```

Nothing unparseable kills a turn: the router degrades to `GENERAL` with no categories (a diagnostic
question goes out), and the advisor degrades to a written fallback.

Notion nodes, all created by the build script:

```
Security Precheck → Notion · KB Query      (databasePage:getAll, returnAll, simple=false)
                  → KB Index

Generate? ─true→ Has KB? ─true→ Split KB Ids → Notion · KB Page (block:getAll) → Fetch KB
                        └false────────────────────────────────────────────────→ Fetch KB

Lead Mapper → Write lead? ─true→ Lead exists? ─true→ Notion · Lead Update ─┐
                          │                   └false→ Notion · Lead Create ─┤
                          └false──────────────────────────────────────────→ Finalize
```

`Notion · KB Query` has **no filters configured** — it fetches all entries and `kb-index.js`
filters `Status = Approved` and `Visibility = Public` itself. One less thing to misconfigure.

There is no leads lookup node. The session already holds `lead_page_id` server-side, so the first
write creates and every later write updates.

## After importing

1. **Pick the Notion credential on all four Notion nodes.** The build script leaves credentials
   empty on purpose — a wrong credential id is worse than an empty one. Both databases must also be
   shared with that Notion integration (Notion → page → ⋯ → Connections).
2. **Pick the Groq credential** on `Groq · router` and `Groq · advisor`.
3. Save and activate.

## Watch these on the first run

**Property names must match exactly.** Each lead property is mapped as `"Name|type"`, e.g.
`Status|select`. If a property in the Advisor Leads database is spelled differently, that row fails.
23 properties are mapped on update, 22 on create (the title goes through the node's own Title field).

**Email and Website are the fragile two.** `lead-mapper.js` emits `null` for them when unknown,
because Notion rejects an empty string for those types. If the first lead write fails validation on
either, delete those two rows from the Notion node's Properties list — everything else still writes.

**Groq models.** `openai/gpt-oss-20b` on the router, `openai/gpt-oss-120b` on the advisor. Both are
Groq production models with strict structured-output support. The earlier `qwen/qwen3.8-27b` is a
preview model — Groq's own docs say preview models are for evaluation, not production.

## Before going live

`validate-state.js` allows local origins so the widget can be tested from a dev server:

```js
const ALLOWED_ORIGINS = [SITE, 'http://localhost', 'http://127.0.0.1'];
```

Drop the two local entries, and narrow the Webhook node's **Allowed Origins (CORS)** from `*` to
`https://simplifiedstartup.com`.

Keep that CORS field in **Fixed** mode. In Expression mode n8n stores the value with a leading `=`,
which ships an invalid `Access-Control-Allow-Origin: =*` header; the browser then rejects the
preflight and never sends the POST — which is what made the widget say "I couldn't reach the
advisor" while n8n's execution log stayed empty.

## Session store trade-offs

- conversations reset if n8n restarts (they expire after 24h anyway)
- one n8n instance only — this does not work in queue mode with several workers
- capped at 500 sessions, least-recently-used dropped first
