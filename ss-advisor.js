/* Simplified Startup — AI Advisor chatbox (vanilla JS, no dependencies)
   Embed: <script src="/assets/advisor/ss-advisor.js" data-endpoint="https://…/webhook/advisor" data-site="https://simplifiedstartup.com" defer></script>
   Security posture: all server text rendered via textContent + a tiny escaping markdown-lite; links only from server `cta`
   and only if their host matches data-site. No secrets in this file. */
(function () {
  'use strict';
  if (window.__ssAdvisorLoaded) return; window.__ssAdvisorLoaded = true;

  // ---------- config ----------
  var script = document.currentScript || document.querySelector('script[data-endpoint]');
  var CFG = {
    endpoint: (script && script.getAttribute('data-endpoint')) || '',
    site: ((script && script.getAttribute('data-site')) || 'https://simplifiedstartup.com').replace(/\/$/, ''),
    mock: script && script.getAttribute('data-mock') === 'true',
    theme: (script && script.getAttribute('data-theme')) || '',
    maxLen: 1500,
    timeoutMs: 30000,
    storageKey: 'ssa.session.v2',
  };
  var SITE_HOST = (function () { try { return new URL(CFG.site).host.replace(/^www\./, ''); } catch (e) { return 'simplifiedstartup.com'; } })();
  var BOOK_URL = CFG.site + '/start-project';

  var QUICK = [
    { id: 'have_idea',        text: "I have an idea and don't know where to start" },
    { id: 'need_launch',      text: 'I need to launch in the next few months' },
    { id: 'traffic_no_leads', text: 'We get traffic but almost no leads' },
    { id: 'marketing_flat',   text: "Our marketing isn't producing pipeline" },
    { id: 'automate',         text: 'I want to automate something repetitive' },
    { id: 'unsure',           text: "I'm not sure what I actually need" },
  ];

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(path) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.appendChild(p); return s; }
  var ICON = { compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.24 5.76-2.83 6.36-6.36 2.83 2.83-6.36 6.36-2.83z', x: 'M18 6 6 18M6 6l12 12', reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5', send: 'M5 12h14M13 6l6 6-6 6', ext: 'M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' };
  function uuid() { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); }
  function safeLink(url) { try { var u = new URL(url); if (u.protocol !== 'https:') return null; if (u.host.replace(/^www\./, '') !== SITE_HOST) return null; return u.href; } catch (e) { return null; } }
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Escape-first markdown-lite: paragraphs, "- " bullets, **bold**. Nothing else. No links, no HTML.
  function renderRich(container, text) {
    container.textContent = '';
    var blocks = String(text).split(/\n\s*\n/);
    blocks.forEach(function (b) {
      var lines = b.split('\n');
      var isList = lines.length && lines.every(function (l) { return /^\s*[-•]\s+/.test(l); });
      if (isList) {
        var ul = el('ul');
        lines.forEach(function (l) { var li = el('li'); inline(li, l.replace(/^\s*[-•]\s+/, '')); ul.appendChild(li); });
        container.appendChild(ul);
      } else { var p = el('p'); inline(p, b); container.appendChild(p); }
    });
    function inline(node, s) {
      var parts = s.split(/(\*\*[^*]+\*\*)/g);
      parts.forEach(function (part) {
        if (/^\*\*[^*]+\*\*$/.test(part)) node.appendChild(el('strong', { text: part.slice(2, -2) }));
        else if (part) node.appendChild(document.createTextNode(part));
      });
    }
  }

  // ---------- state ----------
  var state = {
    open: false, busy: false, started: false,
    stateToken: null, lastPayload: null, askContact: null, closing: false,
    typingEl: null, lastFocus: null,
  };
  // The whole conversation state lives in one encrypted token the server issues each turn.
  // The browser only stores and echoes it; it cannot read or edit what's inside.
  try { var saved = sessionStorage.getItem(CFG.storageKey); if (saved) { state.stateToken = JSON.parse(saved).t || null; } } catch (e) {}
  function persist() { try { sessionStorage.setItem(CFG.storageKey, JSON.stringify({ t: state.stateToken })); } catch (e) {} }

  // ---------- DOM ----------
  var root = el('div', { class: 'ssa-root' });
  if (CFG.theme) root.setAttribute('data-theme', CFG.theme);

  var launcher = el('button', { class: 'ssa-launcher', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ssa-panel', 'aria-label': 'Ask the AI Advisor', 'data-nudge': 'true' }, [
    el('span', { class: 'ssa-launcher-mark' }, [svg(ICON.compass)]),
    el('span', { class: 'ssa-launcher-text' }, [el('strong', { text: 'Ask the AI Advisor' }), el('span', { text: 'Directional advice, instantly' })]),
  ]);

  var titleId = 'ssa-title-' + uuid().slice(0, 6);
  var thread = el('div', { class: 'ssa-thread', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  var input = el('textarea', { class: 'ssa-input', rows: '1', placeholder: "Type what's going on…", 'aria-label': 'Your message', maxlength: String(CFG.maxLen + 200) });
  var sendBtn = el('button', { class: 'ssa-send', type: 'button', 'aria-label': 'Send', disabled: 'true' }, [svg(ICON.send)]);
  var count = el('span', { class: 'ssa-count', 'aria-hidden': 'true', text: '' });
  var resetBtn = el('button', { class: 'ssa-icon-btn', type: 'button', 'aria-label': 'Start over' }, [svg(ICON.reset)]);
  var closeBtn = el('button', { class: 'ssa-icon-btn', type: 'button', 'aria-label': 'Close advisor' }, [svg(ICON.x)]);
  var confirmBar = null;

  var panel = el('section', { class: 'ssa-panel', id: 'ssa-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-open': 'false' }, [
    el('header', { class: 'ssa-head' }, [
      el('div', {}, [el('h2', { id: titleId, text: 'Simplified Startup' }), el('p', { text: 'AI Advisor · directional advice, instantly' })]),
      el('div', { class: 'ssa-head-actions' }, [resetBtn, closeBtn]),
    ]),
    thread,
    el('div', { class: 'ssa-composer' }, [
      el('div', { class: 'ssa-inputrow' }, [input, sendBtn]),
      el('div', { class: 'ssa-foot' }, [
        el('span', { text: "Answers come from Simplified Startup's published information. Nothing here is a quote." }),
        count,
      ]),
    ]),
  ]);
  root.appendChild(launcher); root.appendChild(panel);
  document.body.appendChild(root);

  // ---------- opening state ----------
  function renderOpening() {
    thread.textContent = '';
    var quick = el('div', { class: 'ssa-quick', role: 'group', 'aria-label': 'Quick starts' });
    QUICK.forEach(function (q) {
      quick.appendChild(el('button', { type: 'button', text: q.text, onclick: function () { track('quick_action_clicked', { quick_action_id: q.id }); send(q.text, q.id); } }));
    });
    thread.appendChild(el('div', { class: 'ssa-opening' }, [
      el('h3', { text: 'What are you trying to build, fix, launch, or grow?' }),
      el('p', { text: "One sentence is enough. I'll help you figure out where our team may fit — and where it doesn't." }),
      quick,
    ]));
  }
  renderOpening();

  // ---------- messages ----------
  function addVisitor(text) {
    var m = el('div', { class: 'ssa-msg ssa-msg--visitor' }, [el('div', { class: 'ssa-bubble', text: text })]);
    thread.appendChild(m); scrollEnd(); return m;
  }
  function addSystem(text, isError) {
    var m = el('div', { class: 'ssa-msg ssa-msg--system' + (isError ? ' ssa-msg--error' : ''), text: text });
    thread.appendChild(m); scrollEnd(); return m;
  }
  function showTyping() { hideTyping(); state.typingEl = el('div', { class: 'ssa-msg ssa-msg--advisor' }, [el('span', { class: 'ssa-typing', 'aria-label': 'Advisor is typing' }, [el('i'), el('i'), el('i')])]); thread.appendChild(state.typingEl); scrollEnd(); }
  function hideTyping() { if (state.typingEl) { state.typingEl.remove(); state.typingEl = null; } }

  function addAdvisor(reply, ctas, suggestions, done) {
    hideTyping();
    var m = el('div', { class: 'ssa-msg ssa-msg--advisor' });
    var body = el('div');
    m.appendChild(body); thread.appendChild(m);
    var finish = function () {
      renderRich(body, reply);
      appendCtas(m, ctas || []);
      appendSuggestions(m, suggestions || []);
      scrollEnd(); if (done) done();
    };
    if (reducedMotion || reply.length < 40) return finish();
    // progressive reveal: word chunks, ~ 32 words / 100 ms, so a 120-word answer lands in ~1.5 s
    var words = reply.split(/(\s+)/), i = 0, shown = '';
    (function step() {
      var chunk = 0;
      while (i < words.length && chunk < 4) { shown += words[i++]; if (!/^\s+$/.test(words[i - 1])) chunk++; }
      renderRich(body, shown); scrollEnd();
      if (i < words.length) setTimeout(step, 24); else finish();
    })();
  }

  function appendCtas(m, ctas) {
    var valid = [];
    ctas.slice(0, 2).forEach(function (c) {
      if (!c || typeof c.label !== 'string') return;
      if (c.kind === 'link') { var href = safeLink(c.url); if (href) valid.push({ id: c.id, label: c.label, href: href }); }
      else if (c.kind === 'suggest' && typeof c.text === 'string') valid.push({ id: c.id, label: c.label, text: c.text });
    });
    if (!valid.length) return;
    var row = el('div', { class: 'ssa-ctas' });
    valid.forEach(function (c, ix) {
      if (c.href) {
        var a = el('a', { class: 'ssa-cta' + (c.id === 'consult' ? ' ssa-cta--primary' : ''), href: c.href, target: '_blank', rel: 'noopener noreferrer', text: c.label, onclick: function () { track('cta_clicked', { cta_id: c.id }); } });
        a.appendChild(svg(ICON.ext)); row.appendChild(a);
      } else {
        row.appendChild(el('button', { class: 'ssa-cta', type: 'button', text: c.label, onclick: function () { track('cta_clicked', { cta_id: c.id }); if (/:\s*$/.test(c.text)) { input.value = c.text; input.focus(); autosize(); } else send(c.text, null); } }));
      }
    });
    m.appendChild(row);
  }
  // A chip row can never cover everyone — whoever built it was guessing at who would show up.
  // So the last chip is an escape, and tapping it must not send "Something else" as the answer:
  // that tells the advisor nothing and wastes the visitor's turn. It opens the box instead, so
  // they can say what they actually are in two words.
  // "Other" alone is an escape; "Other businesses (B2B)" is a real answer, so a bare match on the
  // word would swallow a legitimate option and leave the visitor staring at an empty box.
  var ESCAPE = /^\s*(something (else|different)|none of these|neither|not listed|mine('s| is) different)\b|^\s*others?\s*$/i;
  function appendSuggestions(m, suggestions) {
    var list = suggestions.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, 5);
    if (!list.length) return;
    var row = el('div', { class: 'ssa-suggest' });
    list.forEach(function (s) {
      var escape = ESCAPE.test(s);
      row.appendChild(el('button', {
        type: 'button', text: s, class: escape ? 'ssa-escape' : '',
        onclick: function () {
          if (!escape) return send(s, null);
          input.value = '';
          input.placeholder = 'Tell me in a few words…';
          input.focus({ preventScroll: true });
          autosize();
        },
      }));
    });
    m.appendChild(row);
  }
  function scrollEnd() { thread.scrollTop = thread.scrollHeight; }

  // ---------- network ----------
  function clientInfo() {
    return { page_url: location.href.slice(0, 300), referrer: (document.referrer || '').slice(0, 200), tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), locale: navigator.language || '', device: window.innerWidth < 640 ? 'mobile' : 'desktop' };
  }
  function send(text, quickId) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    if (text.length > CFG.maxLen) { addSystem('That message is a little long for me — could you shorten it to the core of it?', true); return; }
    if (!state.started) { state.started = true; var op = thread.querySelector('.ssa-opening'); if (op) op.remove(); }
    addVisitor(text);
    input.value = ''; autosize(); setBusy(true); showTyping();
    var payload = { type: 'message', state_token: state.stateToken, turn_client_id: 't_' + uuid().replace(/-/g, '').slice(0, 24), message: text, quick_action_id: quickId || undefined, client: clientInfo() };
    state.lastPayload = payload;
    request(payload).then(onReply).catch(onFail);
  }
  function request(payload) {
    if (CFG.mock) return mock(payload);
    if (!CFG.endpoint) return Promise.reject({ code: 'unavailable' });
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CFG.timeoutMs) : null;
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl ? ctrl.signal : undefined, credentials: 'omit' })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.status === 429) return r.json().catch(function () { return {}; }).then(function (j) { throw { code: 'rate_limited', retry_after: (j.error && j.error.retry_after) || 20 }; });
        if (r.status === 400) return r.json().catch(function () { return {}; }).then(function (j) { throw { code: (j.error && j.error.code) || 'bad_request' }; });
        if (!r.ok) throw { code: 'unavailable' };
        return r.json();
      }, function () { if (timer) clearTimeout(timer); throw { code: 'unavailable' }; });
  }
  function onReply(data) {
    setBusy(false);
    if (!data || typeof data.reply !== 'string') return onFail({ code: 'unavailable' });
    if (typeof data.state_token === 'string' && data.state_token.length < 16000) { state.stateToken = data.state_token; persist(); }
    var st = data.state || {};
    state.askContact = st.ask_contact || null; state.closing = !!st.closing;
    addAdvisor(data.reply, Array.isArray(data.cta) ? data.cta : [], Array.isArray(data.suggestions) ? data.suggestions : [], function () {
      if (state.askContact === 'email') { input.setAttribute('type', 'email'); input.placeholder = 'Your email (optional)'; }
      else if (state.askContact === 'name') { input.placeholder = 'Your name (optional)'; }
      else { input.placeholder = 'Reply…'; }
      if (state.open) input.focus({ preventScroll: true });
    });
  }
  function onFail(err) {
    setBusy(false); hideTyping();
    var code = (err && err.code) || 'unavailable';
    if (code === 'rate_limited') { addSystem("You're sending messages faster than I can read them. Give me a moment and try again.", true); return; }
    if (code === 'message_too_long') { addSystem('That message is a little long for me — could you shorten it to the core of it?', true); return; }
    if (code === 'bad_request') { addSystem("I couldn't read that. Try rephrasing it.", true); return; }
    var m = addSystem("I couldn't reach the advisor just now.", true);
    var row = el('div', { class: 'ssa-retry' }, [
      el('button', { class: 'ssa-cta', type: 'button', text: 'Try again', onclick: function () { m.remove(); if (state.lastPayload) { setBusy(true); showTyping(); request(state.lastPayload).then(onReply).catch(onFail); } } }),
      el('a', { class: 'ssa-cta', href: BOOK_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Book a consultation instead' }),
    ]);
    m.appendChild(row); scrollEnd();
  }
  function setBusy(b) { state.busy = b; sendBtn.disabled = b || !input.value.trim(); input.readOnly = b; }

  // ---------- analytics beacon (no message content) ----------
  function track(event, props) {
    if (CFG.mock || !CFG.endpoint) return;
    var body = JSON.stringify({ type: 'event', state_token: state.stateToken, event: event, props: props || {} });
    try { if (navigator.sendBeacon) { navigator.sendBeacon(CFG.endpoint, new Blob([body], { type: 'application/json' })); return; } } catch (e) {}
    try { fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' }); } catch (e) {}
  }

  // ---------- open / close / reset ----------
  function open() {
    if (state.open) return; state.open = true; state.lastFocus = document.activeElement;
    panel.setAttribute('data-open', 'true'); launcher.setAttribute('aria-expanded', 'true');
    track('chat_opened', { page_url: location.pathname });
    setTimeout(function () { (state.started ? input : thread.querySelector('.ssa-quick button') || input).focus({ preventScroll: true }); }, 60);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    if (!state.open) return; state.open = false;
    panel.setAttribute('data-open', 'false'); launcher.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus(); else launcher.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { // focus stays within the panel while open (mobile is full-screen)
      var f = panel.querySelectorAll('button:not([disabled]), a[href], textarea');
      if (!f.length) return; var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function askReset() {
    if (confirmBar) return;
    confirmBar = el('div', { class: 'ssa-confirm', role: 'alert' }, [
      el('span', { text: 'Start a new conversation? This one will be cleared.' }),
      el('button', { class: 'ssa-yes', type: 'button', text: 'Start over', onclick: doReset }),
      el('button', { type: 'button', text: 'Keep going', onclick: function () { confirmBar.remove(); confirmBar = null; input.focus(); } }),
    ]);
    panel.insertBefore(confirmBar, thread);
  }
  function doReset() {
    track('conversation_reset', {});
    if (confirmBar) { confirmBar.remove(); confirmBar = null; }
    state.stateToken = null; state.started = false; state.askContact = null; state.closing = false; state.lastPayload = null; persist();
    input.value = ''; input.placeholder = "Type what's going on…"; input.removeAttribute('type'); autosize();
    renderOpening(); thread.scrollTop = 0;
    var q = thread.querySelector('.ssa-quick button'); if (q) q.focus();
  }

  // ---------- composer ----------
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; var n = input.value.length; count.textContent = n > CFG.maxLen * 0.8 ? n + ' / ' + CFG.maxLen : ''; count.setAttribute('data-over', n > CFG.maxLen ? 'true' : 'false'); sendBtn.disabled = state.busy || !input.value.trim() || n > CFG.maxLen; }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value, null); } });
  sendBtn.addEventListener('click', function () { send(input.value, null); });
  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  resetBtn.addEventListener('click', askReset);

  // Let the site's own "Talk to AI Advisor" / "Try the AI Advisor" buttons open the panel.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-ss-advisor-open], a[href="#ai-advisor"]');
    if (t) { e.preventDefault(); open(); }
  });
  window.SSAdvisor = { open: open, close: close, reset: doReset };

  // ---------- local preview only (data-mock="true"); never ship enabled ----------
  function mock(p) {
    return new Promise(function (res) {
      setTimeout(function () {
        var lower = p.message.toLowerCase(), reply, cta = [], sug = [];
        if (/prompt|instruction|notion/.test(lower)) reply = "I can help with Simplified Startup's services and how the team might fit your business, but I can't share internal system information.\n\nIf you're evaluating the advisor itself, I can explain what it can help you with.";
        else if (/cost|price|how much/.test(lower)) { reply = "Pricing depends on the scope and the team involved, and I don't want to give you an inaccurate number.\n\nIf you tell me a bit about what you're looking to build, I can help you understand what kind of engagement you'd be looking at — and the team can scope it properly in writing."; cta = [{ id: 'consult', label: 'Book a free consultation', url: BOOK_URL, kind: 'link' }]; }
        else if (/traffic|leads/.test(lower)) { reply = "If you're already getting traffic, the first question I'd look at is where people drop off rather than how to send more.\n\nSimplified Startup works across web, growth, marketing and sales, so the right starting point depends on whether the issue is positioning, conversion, lead capture, or what happens after someone shows interest.\n\nWhat happens today when someone lands on your site and wants to learn more?"; sug = ["There's a contact form nobody fills in", "We don't really know", 'They can book a demo but rarely do']; }
        else if (/not sure|don't know/.test(lower)) { reply = "Then let's not start with services.\n\nWhat are you trying to accomplish over the next 3–6 months — the outcome, not the tactic?"; sug = ['Get our first paying customers', 'Launch a first version', 'Grow revenue from what we have']; }
        else { reply = "Got it. Before I point at any particular area, it helps to know where you are: is this pre-launch, early revenue, or something already growing that's hit a wall?\n\nFrom there I can tell you which parts of the problem usually belong together."; cta = [{ id: 'tell_more', label: 'Tell me more about your situation', kind: 'suggest', text: "Here's more detail on my situation: " }]; }
        res({ state_token: 'mock', reply: reply, cta: cta, suggestions: sug, state: { phase: 'DIAGNOSING', handoff: false, ask_contact: null, closing: false } });
      }, 900);
    });
  }
})();
