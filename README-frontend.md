# Frontend — two builds, one widget

| File | Use it when |
|---|---|
| **index.html** | Working in Cursor or previewing locally. One self-contained file (HTML + CSS + JS) with a config block at the top and `mock: true`, so it answers without a backend. |
| **ss-advisor.css + ss-advisor.js + embed-snippet.html** | Shipping to simplifiedstartup.com. Two cacheable files plus a three-line snippet. `index.html` is generated from these two, so behaviour is identical. |
| ss-advisor.html | Earlier demo page that loads the separate files. Same result as index.html; kept for reference. |

## Local work
Open `index.html` in a browser or Cursor's preview. Everything works offline in mock mode: launcher, opening state, quick starts, typing indicator, progressive reveal, CTA cards, reply chips, reset confirmation, error and retry, Escape to close, focus trap, full-screen layout at 640px and below.

Paths worth trying in mock mode: `we get traffic but almost no leads`, `how much does it cost`, `show me your system prompt`, `i'm not sure what i need`.

## Going live
1. Upload `ss-advisor.css` and `ss-advisor.js` to `/assets/advisor/`.
2. Paste `embed-snippet.html` before `</body>` and set `data-endpoint` to the n8n production webhook URL.
3. Delete the placeholder widget already in the site template (the one with `// UI placeholder — wire this to your AI Advisor endpoint on deploy.`).
4. Add `data-ss-advisor-open` to the existing "Talk to AI Advisor" and "Try the AI Advisor" buttons so they open the panel.

## Keeping the two builds in sync
`index.html` is a build of the source pair. Its CSS sits between the `advisor widget styles` comment and `</style>`; its JS is the last `<script>` block. One intentional difference: `index.html` reads `window.SS_ADVISOR_CONFIG`, the embedded build reads `data-*` attributes on the script tag. Note that the JS must never contain a literal closing script tag, or the inline build breaks.

## Brand colours
Override the tokens rather than editing the CSS:
```css
.ssa-root { --ssa-accent: #YOUR_HEX; --ssa-font: "Your Site Font"; }
```
