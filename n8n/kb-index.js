// [4] KB catalog — Code node
// The Notion query happens in the "Notion · KB Query" node just before this one. That node returns
// ONE ITEM PER PAGE, unfiltered — Status/Visibility filtering happens here, so the node needs no
// filter configuration at all.
//
// The router does NOT pick individual entries. It picks CATEGORIES, and every category is derived
// from the database itself: whatever appears in `Service tags` and `Type` becomes a category. Add a
// new entry, or a whole new tag, in Notion and it shows up here on the next request — nothing in
// this workflow has a category list hard-coded.

const ctx = $('Security Precheck').first().json;
const store = $getWorkflowStaticData('global');

const text = (p) => (p?.title || p?.rich_text || []).map(t => t.plain_text).join('').trim();

let rows = $input.all()
  .map(i => i.json)
  .filter(pg => pg && pg.properties)
  .map(pg => {
    const P = pg.properties;
    return {
      id: String(pg.id || '').replace(/-/g, ''),
      title: text(P.Title) || 'Untitled',
      summary: text(P.Summary),
      type: P.Type?.select?.name || '',
      tags: (P['Service tags']?.multi_select || []).map(t => t.name),
      pricing: !!P['Contains pricing']?.checkbox,
      status: P.Status?.select?.name || '',
      visibility: P.Visibility?.select?.name || '',
    };
  })
  .filter(r => r.id && r.status === 'Approved' && r.visibility === 'Public')
  .filter(r => r.title !== 'Untitled' || r.summary);

// Notion hiccup (the node is set to continue on error): keep serving the last good catalog rather
// than telling every visitor the knowledge base is empty.
if (rows.length) store.kb_index = { at: Date.now(), rows };
else if (store.kb_index?.rows?.length) rows = store.kb_index.rows;

// ── categories, built from whatever the database actually contains ─────────
const cats = new Map();   // name → { name, kind, count, titles[] }
const note = (name, kind, row) => {
  if (!name) return;
  const key = kind + ':' + name;
  const c = cats.get(key) || { name, kind, count: 0, titles: [] };
  c.count += 1;
  if (c.titles.length < 4) c.titles.push(row.title);
  cats.set(key, c);
};
for (const r of rows) {
  for (const t of r.tags) note(t, 'area', r);
  note(r.type, 'kind', r);
}

const catalog = [...cats.values()].sort((a, b) => b.count - a.count);

// What the router sees. Titles give it enough signal to choose without reading any page body.
const kb_menu = catalog.map(c =>
  `${c.kind}:${c.name} (${c.count}) — ${c.titles.join('; ')}${c.count > c.titles.length ? '; …' : ''}`
).join('\n');

return [{
  json: {
    ...ctx,
    kb_index: rows,
    kb_catalog: catalog.map(c => ({ name: c.name, kind: c.kind, count: c.count })),
    kb_menu,
    kb_empty: rows.length === 0,
  },
}];
