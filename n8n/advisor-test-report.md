# AI Advisor — live test report

Run against `https://n8n.notaiagent.com/webhook/advisor` on 2026-09-18, with the three fixes
(leak guard, `slice(0,3)`, `&` escaping) live and the three priced KB entries set to
`Visibility = Internal`.

## What actually ran

**14 of the planned 85 questions.** The Groq account hit its rate limit partway through, so the
50 standalone questions and the 20 off-topic questions were never sent. Nothing below is invented —
every answer here is a real response from the live webhook.

| Planned | Ran | Status |
|---|---|---|
| 14-turn founder conversation | 14 | done |
| 50 standalone questions | 0 | not run — Groq quota |
| 20 off-topic questions | 0 | not run — Groq quota |

The 14 turns are enough to find serious problems. They are not enough to judge knowledge coverage,
off-topic handling, or prompt-injection defence — those still need testing.

To finish the run: top up Groq, set `LIMITS` in **Validate + State** to
`{ per_min: 30, per_hour: 300 }` temporarily, and re-run. The runner and question list are ready.

## Headline numbers

```
turns                 14
real AI answers        5   (turns 3, 7, 9, 11, 14)
fallback replies       9   → 64% of the conversation was a canned fallback
  llm_failure          6   (turns 4, 6, 8, 10, 12, 13)
  pricing_unknown      2   (turns 1, 5)
  broken               1   (turn 2)

latency          min 2.0s   median 5.0s   max 7.9s   mean 4.9s
CTA shown        9/14   (consult ×8, explore_first ×1)
asked for email  12/14 turns
phase path       DIAGNOSING → CAPTURING   (never reached HANDOFF)
suggestions      only ever ["I'd rather book directly"]
```

**A visitor having this conversation would leave.** Two thirds of it was the bot saying it lost the
thread or deflecting to pricing, while asking for an email almost every single turn.

---

## Full transcript, with a verdict on each turn

### Turn 1 — ✗ wrong intent
> **Visitor:** We're a 6-person B2B SaaS doing about $40k MRR
>
> **Advisor:** Pricing comes down to scope and which part of the team is involved, and I'd rather not give you a number that turns out to be wrong. […]

The visitor introduced themselves. They asked nothing. The advisor answered a pricing question
nobody asked. The `$40k MRR` almost certainly set the router's `price` signal or `PRICING` intent —
a **revenue figure is being read as a pricing enquiry**. Worst possible opening: it ignores the
person and talks about money.

### Turn 2 — ✗ broken fallback, and a premature email grab
> **Visitor:** We get decent traffic but almost nobody books a demo
>
> **Advisor:** Let me keep this simple: tell me the one thing that's most stuck right now […] If you'd like the team to pick this up with context, what's the best email to reach you

This is the `BROKEN` fallback (`too_long` / `too_short` / `too_many_questions`). The visitor just
handed over a textbook qualifying problem and got nothing.

Worse: `phase` jumped to **CAPTURING** and `handoff` to **true** on turn 2 — asking for an email
after delivering zero value. This is exactly what the prompt's "earn the next step" section forbids,
but the phase machine overrides the prompt.

### Turn 3 — ~ good advice, but it promises something it cannot do
> **Advisor:** If Google Ads aren't converting, the bottleneck is often the landing experience or the demo-booking flow rather than the spend itself. […] **Could you share your email so we can send a brief audit outline** […]

The diagnostic reasoning is genuinely good. Two problems:

- **It promises to send an audit.** Nobody authorised that, and the system cannot send email. The
  `fake_action` check only catches `I'll send` / `someone will contact` — it misses **"we can send"**.
- **No company grounding at all.** Generic marketing advice. Nothing from the KB.

### Turn 4 — ✗ LLM failure
> **Visitor:** So what would you actually do first if it were your company?
>
> **Advisor:** I lost the thread on that one.

The single most important question in the whole conversation. Dropped.

### Turn 5 — ✗ wrong intent again
> **Visitor:** How long before we'd see something change?
>
> **Advisor:** Pricing comes down to scope […]

A **timeline** question answered with the **pricing** fallback. The KB has
`FAQ — Common founder questions` covering launch speed, and `Process — Four phases`. Neither was used.

### Turn 6 — ✗ LLM failure
> **Visitor:** Would you rebuild the website too, or just fix the funnel?

Straight service-scope question. Dropped.

### Turn 7 — ~ answers, but overpromises again
> **Advisor:** Pricing for a demo-booking funnel depends on how much work is already in place […] **If you share the best email address, I can send a brief audit outline that shows the likely effort and a more concrete cost range.**

Correct that it refuses a number. But it promises to **email a cost range** — which contradicts the
KB (prices are fixed in the free growth plan, in writing, not emailed) and is an action the system
cannot perform.

### Turn 8 — ✗ LLM failure
> **Visitor:** We're also talking to two other agencies right now

A competitive-comparison signal — the highest-intent moment in the conversation, and the KB has
`Positioning — How we compare to specialists, agencies and internal teams` for exactly this.
Dropped.

### Turn 9 — ✓ decent
> **Advisor:** Got it – aiming to kick off the demo-booking work next month makes sense. To put together a brief audit and outline the steps we'd take, could you share the best email address […]

Acknowledges the timeline, asks for one thing. Still promises an audit it cannot deliver.

### Turn 10 — ✗ LLM failure
> **Visitor:** If we stop working together, who owns the site and the ad accounts?

2.0 s response — too fast for a model call, so the Advisor node errored immediately (almost
certainly a Groq 429). The KB has `Policy — Terms, ownership and guarantees` which answers this
precisely: *you own everything, ad spend paid direct and never marked up*. A trust-critical question,
dropped.

### Turn 11 — ~ works, but the reply starts mid-sentence
> **Advisor:** we can connect you with one of our partners for a live conversation.

Lowercase `we`. The sycophancy stripper removed a leading "Sure," and never re-capitalised.
Small, but it reads broken.

### Turn 12 — ✗ LLM failure on the email itself
> **Visitor:** Sure, it's utkarsh@ecommercecollections.com
>
> **Advisor:** I lost the thread on that one. […] what's the best email to reach you

**The worst failure in the run.** The visitor handed over their email and the advisor asked for it
again. The lead was never captured: `ask_contact` stayed `email`, phase never reached `HANDOFF`,
and the Notion row never got the address.

### Turn 13 — ✗ LLM failure
> **Visitor:** Anything I should have ready before that call?

Dropped.

### Turn 14 — ✗ tone-deaf
> **Visitor:** Great, thanks for the help
>
> **Advisor:** To lift your demo booking rate in the next 1-3 months, consider tightening your Google Ads targeting […] *(130 words of tactics)*

The visitor said goodbye. The advisor delivered a pitch. No read of conversational context at all.

---

## Problems, ranked

### P1 — 43% of turns died in the LLM node
Six of fourteen turns returned `llm_failure`. Turn 10 came back in 2.0 s, far too fast for a
generation, so the Advisor node errored rather than answered — consistent with Groq 429s, which is
also what ended this test run.

Whatever the cause, **the workflow cannot tell a rate limit from a bad response**. Both land on
`onError: continueErrorOutput` → `LLM Failed` → the same "I lost the thread" line.

Fix:
- Add a **retry** on the Advisor and Router nodes (n8n node setting: Retry On Fail, 2 tries, 2 s wait).
  A 429 usually clears on the second attempt.
- Add a **fallback model** (the chainLlm node has an "Enable Fallback Model" toggle) so a second
  provider or the smaller Groq model picks up when the primary is throttled.
- Make `LLM Failed` distinguish a throttle from a parse failure, and say something honest and
  different for each rather than the same line six times.

### P2 — the email was handed over and thrown away
Turn 12. If the Advisor node fails, `Merge State` never extracts attributes, so `S.contact.email`
is never set. A lead was lost on a turn that was otherwise a conversion.

Fix: extract contact details **before** the LLM, deterministically. An email regex on
`payload.message` in `Security Precheck` or `Validate + State` costs nothing and cannot fail:

```js
const m = message.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/);
if (m) S.contact.email = m[0].toLowerCase();
```

The model should confirm the email, never be responsible for capturing it.

### P3 — it asks for an email on 12 of 14 turns
`ask_contact` was `email` for 13 straight turns, and `qualify-cta.js` appends the same sentence
every time `ask_contact === 'email'` and the reply does not already contain "email". Read as a
whole conversation it is nagging, and it is the opposite of the prompt's stated posture.

Fix: ask at most **once every three turns**, and stop after two refusals. Track
`S.flags.email_asks` and gate on it.

### P4 — phase jumps to CAPTURING on turn 2
`handoff` went true at turn 2 because `S.flags.low_conf >= 2` — two fallbacks in a row is read as
"the advisor is struggling, hand to a human". That rule is sound in principle, but combined with P1
it means **LLM failures silently convert into a sales push**.

Fix: do not let `low_conf` alone trigger handoff. Require a real intent signal (`hire`, `call`,
`decision_stage = ready`) or at least turn ≥ 3 with something learned about the visitor.

### P5 — a revenue figure reads as a pricing question
Turn 1 (`$40k MRR`) and turn 5 (a timeline question) both produced the pricing fallback.

Fix, in the router prompt: add an explicit line —

> A number the visitor states about **their own business** (revenue, MRR, team size, budget they
> already spend) is context, not a pricing question. `price` is true only when they ask what
> **Simplified Startup** charges.

### P6 — "we can send you X" slips past the fake-action check
Turns 3, 7 and 9 all promise an emailed audit or cost range. The advisor cannot send anything.

Fix, in `validate-output.js`, add to the fake-action patterns:

```js
/\b(we|i) (can|could|will|'ll) (send|email|share|put together|prepare)\b/i
/\b(send|email) (you|over) (a|an|the)\b/i
```

And in the advisor prompt, replace the vague promise with the real next step: the **free growth
plan**, which is a published, real thing.

### P7 — zero company grounding across the whole conversation
Not one answer used the KB. No service description, no four-phase process, no ownership policy, no
free growth plan — even when asked directly (turn 10). Every real answer was generic marketing
advice that any chatbot could give.

This is the difference between an advisor and a chatbot, and right now it is a chatbot. Partly a
consequence of P1, but turns 3, 7, 9 and 14 *did* run and still cited nothing.

Fix: check what `Merge State` selected on those turns. If `categories` came back empty, the router
is not choosing categories for conversational turns — the prompt says return an empty list when the
visitor "is just describing their situation", and that rule is firing too often.

### P8 — the closing turn got a sales pitch
Turn 14. Add to the advisor prompt:

> If the visitor is closing the conversation — thanks, that's all, bye — reply in one or two warm
> sentences and stop. Do not add advice, do not add a CTA.

### P9 — suggestions are dead weight
Every turn offered exactly one chip: *"I'd rather book directly"*. `qualify-cta.js` overwrites
`suggestions` whenever `ask_contact` is set, discarding the model's `answer_options`.

Fix: keep the model's suggestions and **append** the opt-out, rather than replacing.

### P10 — reply starts lowercase after sycophancy stripping
Turn 11. One line in `validate-output.js`:

```js
reply = reply.replace(/^(absolutely|certainly|...)[!.,]?\s*(—|-)?\s*/i, '');
reply = reply.charAt(0).toUpperCase() + reply.slice(1);   // ← add this
```

### P11 — latency
Median 5.0 s, max 7.9 s. For a chat widget that is slow enough to feel broken. Two LLM calls plus
2–4 Notion calls per turn. The KB catalog cache (30 min) would remove one Notion call; the agent
rebuild we discussed would remove another.

---

## CTA and conversion — assessment

| | |
|---|---|
| CTA shown | 9 of 14 turns |
| Which | `consult` ×8, `explore_first` ×1 |
| Variety | essentially one CTA repeated |
| Service CTA | never shown |
| Pricing CTA | never shown (correct — pricing is hidden) |
| Lead captured | **no**, despite the visitor volunteering an email |

The CTA logic itself behaved as designed. The problem is what sits around it: the conversation never
earned the click. `consult` appeared from turn 2, before a single useful answer, and then on almost
every turn after. A real visitor reads that as a bot trying to get rid of them.

`shownRecently('consult')` only looks at the **last one** CTA entry, so the same button reappears
every other turn. Widen it to the last three.

**Conversion verdict: this conversation would not convert.** The one moment it could have — turn 12,
email volunteered — is the moment the system failed.

---

## Prompt changes to make

**Router** (`prompts/router.txt`)
1. Numbers about the visitor's own business are context, not a pricing question (P5).
2. Be less eager to return an empty `categories` list. If the visitor describes a problem, pick the
   area that problem belongs to — the advisor should be able to say what the company does about it (P7).
3. Add `closing` as a recognised intent, or at least a signal, so goodbyes are handled (P8).

**Advisor** (`prompts/advisor.txt`)
1. Never promise to send, email, prepare or share anything. The only real next step is the free
   growth plan or the consultation booking (P6).
2. If the visitor is closing, reply in one or two warm sentences and stop (P8).
3. When the visitor states their situation, name the relevant service area and what the team
   actually does about it — do not give service-agnostic marketing advice (P7).
4. Ask for contact details at most once every few turns; if they gave it, confirm and move on (P3).

## Code changes to make

| File | Change | Problem |
|---|---|---|
| Advisor + Router nodes | Retry On Fail (2 tries, 2 s) + fallback model | P1 |
| `validate-state.js` | extract email with a regex before any LLM runs | P2 |
| `qualify-cta.js` | throttle the email ask; keep model suggestions and append the opt-out; widen `shownRecently` to 3 | P3, P9 |
| `merge-state.js` | `low_conf` alone must not trigger handoff | P4 |
| `validate-output.js` | add "we can send / email you" to fake-action; re-capitalise after stripping | P6, P10 |
| `fallbacks.js` | separate throttle from parse failure; vary the message | P1 |
| `kb-index.js` | re-enable the 30-minute catalog cache | P11 |

## Additional features worth having

1. **Streaming.** At a 5 s median, the visitor stares at a typing dot. Even streaming the first
   sentence changes the felt speed completely. The widget already has a typing indicator to hang it on.
2. **Deterministic contact capture** — see P2. Email, phone and company name should be pulled by
   regex, never trusted to the model.
3. **Retry + fallback model** — see P1. Today one Groq 429 costs a whole turn.
4. **A "what changed" signal on the lead row.** The Notion row currently overwrites; a short
   timestamped log of what was learned each turn would tell sales what actually happened.
5. **Answer-quality logging.** `S.fallbacks` already records every fallback with its reason. Write
   that to the lead row (it is already in Internal notes) and, better, to a small table so you can
   see the fallback rate over time. Today nobody would have noticed 64%.
6. **KB coverage report.** `knowledge_answered` events record `support` per turn. A weekly count of
   `NOT_SUPPORTED` questions tells you exactly which KB entries to write next.
7. **Conversation resume.** Sessions live 24 h server-side but the widget drops the token on tab
   close. Persisting it in `localStorage` would let a returning visitor continue.

## What still needs testing

Everything except the conversation path:

- 50 standalone questions — knowledge coverage, pricing refusal, policy answers, multi-question turns
- 20 off-topic questions — does it stay in scope, does it close gracefully after three
- prompt injection and internal probes — the security precheck has never been exercised live
- lead write — no Notion row was created in this run, so create/update is still unverified end to end
