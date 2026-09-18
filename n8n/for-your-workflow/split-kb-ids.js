// [7b] Split KB ids — Code node
// One item per page the router picked, so the "Notion · KB Page" node runs once per id.
// Guarded by the "Has KB?" IF node, so this never sees an empty list.
//
// No slicing here. Merge State already capped the list (6 pages / 18k chars) after ranking, and
// a second cap at a different number silently drops pages it had chosen — they then arrive with
// no body and get discarded, so the advisor answers from less than it was given.

const x = $input.first().json;
return (x.kb_ids || []).map(id => ({ json: { kb_id: id } }));
