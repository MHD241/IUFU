/* IUFU Console. No dependencies. All authorisation is enforced by the database
   (row-level security + role checks); this file is only the interface.
   Data is written with textContent / DOM nodes, never innerHTML. */
(function () {
'use strict';

var CFG = window.IUFU_CFG || {};
var $ = function (id) { return document.getElementById(id); };
var KIND_LABEL = { video: 'Episode', short: 'Short' };
var WHERE = {
  video: 'Shown in the Episodes section (الحلقات). The first 4 live episodes, in this order, fill the homepage grid.',
  short: 'Shown in the Shorts row and full-screen feed (مقاطع السيرة), in this order.'
};
var DEFAULT_CAT = 'السيرة النبوية';
function ytUrl(kind, id) { return kind === 'short' ? 'https://youtube.com/shorts/' + id : 'https://youtu.be/' + id; }
function norm(r) {          // database row -> interface item
  return { id: r.id, kind: r.kind, platform: 'youtube', external_id: r.youtube_id, url: r.youtube_id ? ytUrl(r.kind, r.youtube_id) : '',
    title: r.title, category: r.category, position: r.position, active: !!r.published, isNew: !!(r.featured && r.published), created: r.created_at };
}

/* ---------- tiny DOM helper ---------- */
function h(tag, props, kids) {
  var e = document.createElement(tag), k;
  props = props || {};
  for (k in props) {
    if (k === 'class') e.className = props[k];
    else if (k === 'text') e.textContent = props[k];
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
    else e.setAttribute(k, props[k]);
  }
  (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function show(el, on) { el.hidden = !on; }
function say(el, text, cls) { el.textContent = text || ''; el.className = 'msg' + (cls ? ' ' + cls : ''); show(el, !!text); }
function safeHref(u) { return typeof u === 'string' && /^https:\/\//.test(u) ? u : '#'; }

/* ---------- session (kept in sessionStorage: cleared when the tab closes) ---------- */
var S = null, role = null;
function loadSession() { try { S = JSON.parse(sessionStorage.getItem('iufu.s')); } catch (e) { S = null; } }
function saveSession() { try { if (S) sessionStorage.setItem('iufu.s', JSON.stringify(S)); else sessionStorage.removeItem('iufu.s'); } catch (e) {} }
function setSession(j) {
  S = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
        email: j.user && j.user.email, uid: j.user && j.user.id };
  saveSession();
}

async function raw(path, o) {
  o = o || {};
  var hd = { apikey: CFG.key, 'Content-Type': 'application/json' };
  if (o.token) hd.Authorization = 'Bearer ' + o.token;
  if (o.prefer) hd.Prefer = o.prefer;
  var r;
  try {
    r = await fetch(CFG.url + path, { method: o.method || 'GET', headers: hd, cache: 'no-store',
      body: o.body ? JSON.stringify(o.body) : undefined });
  } catch (e) { var ne = new Error('Network error: could not reach the server. Nothing was changed.'); ne.status = 0; throw ne; }
  var t = await r.text(), j = null;
  try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) {
    var er = new Error((j && (j.message || j.msg || j.error_description || j.error)) || ('Server returned HTTP ' + r.status));
    er.status = r.status; er.code = j && j.code; throw er;
  }
  return j;
}
async function fresh() {
  if (S && S.exp - Date.now() < 60000) {
    try { setSession(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: S.refresh } })); }
    catch (e) { await signOut('Your session expired. Please sign in again.'); throw e; }
  }
}
async function api(path, o) {
  o = o || {};
  await fresh();
  if (S) o.token = S.access;
  try { return await raw(path, o); }
  catch (e) { if (e.status === 401) { await signOut('Your session is no longer valid. Please sign in again.'); } throw e; }
}

/* ---------- state ---------- */
var rows = [];               // server rows
var edits = {};              // id -> changed fields
var flags = {};              // id -> 'remove' | 'restore'
var adds = [];               // new items not yet saved
var tab = 'video';
var dlg = { mode: null, id: null, kind: null };
var rmId = null;
var newPick;                 // undefined = no change; item id (or tmp id) = make it the New video; 'none' = no New video

function serverNew() { var r = rows.filter(function (x) { return x.isNew && x.active; })[0]; return r ? r.id : null; }
function effNew() {          // id of the video that will be the New video after publishing
  var a = adds.filter(function (x) { return x.is_new; })[0], id;
  if (a) return a.tmp;
  id = newPick === undefined ? serverNew() : (newPick === 'none' ? null : newPick);
  return id && flags[id] === 'remove' ? null : id;
}
function setNew(id) {        // id or null
  adds.forEach(function (a) { a.is_new = false; });
  var tmp = adds.filter(function (a) { return a.tmp === id; })[0];
  if (tmp) { tmp.is_new = true; newPick = undefined; return; }
  if (id === null) newPick = serverNew() ? 'none' : undefined;
  else newPick = id === serverNew() ? undefined : id;
}
function findItem(id) {
  var r = rows.filter(function (x) { return x.id === id; })[0];
  if (r) return r;
  var a = adds.filter(function (x) { return x.tmp === id; })[0];
  return a ? { title: a.title, url: a.url } : null;
}

function eff(r) {            // row with pending edits applied
  var e = edits[r.id], o = {}, k;
  for (k in r) o[k] = r[k];
  if (e) for (k in e) o[k] = e[k];
  if (flags[r.id] === 'remove') o.active = false;
  if (flags[r.id] === 'restore') o.active = true;
  return o;
}
function pendingCount() { return adds.length + Object.keys(edits).length + Object.keys(flags).length + (newPickChanged() ? 1 : 0); }
function newPickChanged() { return newPick !== undefined && !adds.some(function (a) { return a.is_new; }); }
function itemsFor(kind) {
  var list = rows.filter(function (r) { return r.kind === kind; }).map(function (r) { var o = eff(r); o._pend = !!(edits[r.id] || flags[r.id]); return o; });
  adds.forEach(function (a) { if (a.kind === kind) list.push({ id: a.tmp, tmp: true, _pend: true, kind: a.kind, platform: 'youtube', external_id: a.external_id, url: a.url, title: a.title, category: a.category, position: a.position, active: true }); });
  list.sort(function (a, b) { return a.position - b.position || String(a.created || '').localeCompare(String(b.created || '')); });
  return list;
}

/* ---------- link parsing & validation (mirrors the database constraints) ---------- */
function parseLink(kind, text) {
  var s = (text || '').trim();
  if (!s) return { error: 'Enter a link.' };
  var u;
  try { u = new URL(s); } catch (e) { return { error: 'That is not a valid link. Paste the full address starting with https://' }; }
  if (u.protocol !== 'https:') return { error: 'Only https:// links are accepted.' };
  var host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  var id = null, mm;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { mm = u.pathname.match(/^\/(shorts|embed|live)\/([^\/]+)/); if (mm) id = mm[2]; }
  } else return { error: 'Only YouTube links are supported here (youtube.com or youtu.be).' };
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return { error: 'No valid 11-character YouTube video ID was found in that link.' };
  return { ok: true, platform: 'youtube', external_id: id, url: ytUrl(kind, id) };
}
function sameItemElsewhere(kind, p, exceptId) {
  var key = p.external_id || p.url, hit = null;
  itemsFor(kind).forEach(function (i) {
    if (i.id !== exceptId && i.active && (i.external_id || i.url) === key) hit = i;
  });
  return hit;
}

/* ---------- views ---------- */
function thumbNode(i) {
  var box = h('div', { class: 'thumb' });
  if (i.platform === 'youtube' && i.external_id) {
    var im = h('img', { src: 'https://i.ytimg.com/vi/' + i.external_id + '/hqdefault.jpg', alt: '', loading: 'lazy' });
    im.addEventListener('error', function () { im.remove(); box.textContent = 'No preview'; });
    box.appendChild(im);
  } else box.textContent = 'No preview';
  return box;
}

function render() {
  var kind = tab;
  var q = $('q').value.trim().toLowerCase(), st = $('status').value;
  var all = itemsFor(kind);
  var liveRank = {}, n = 0;
  all.forEach(function (i) { if (i.active) liveRank[i.id] = ++n; });
  var list = all.filter(function (i) {
    if (st === 'live' && !i.active) return false;
    if (st === 'removed' && i.active) return false;
    if (q && ((i.title || '') + ' ' + i.url + ' ' + (i.external_id || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  $('where').textContent = WHERE[kind] + ' ' + n + ' live.';
  var nid = effNew(), nit = nid && findItem(nid);
  $('newNow').textContent = nit ? '★ New video on the website: ' + (nit.title || nit.url) : 'No video is marked as the New video right now.';
  var ul = $('list'); clear(ul);
  list.forEach(function (i) {
    var tags = [h('span', { class: 'tag', text: i.category || DEFAULT_CAT, dir: 'auto' })];
    if (i.active) {
      var r = liveRank[i.id];
      tags.push(h('span', { class: 'tag', text: kind === 'video' ? (r <= 4 ? 'Homepage slot ' + r : 'Not shown (only first 4)') : 'Position ' + r }));
    } else tags.push(h('span', { class: 'tag', text: 'Removed from site' }));
    if (i.active && effNew() === i.id) tags.push(h('span', { class: 'tag gold', text: '★ New video on the website' }));
    if (i._pend) tags.push(h('span', { class: 'tag gold', text: i.tmp ? 'Not saved yet' : 'Changed, not saved' }));
    var acts = [];
    if (i.active) {
      var cbn = h('input', { type: 'checkbox', 'aria-label': 'New video on the website' });
      cbn.checked = effNew() === i.id;
      cbn.addEventListener('change', function () { setNew(cbn.checked ? i.id : null); sync(); });
      acts.push(h('label', { class: 'inline newck' }, [cbn, 'New video on the website']));
    }
    if (i.active) acts.push(h('a', { class: 'btn line sm', href: safeHref(i.url), target: '_blank', rel: 'noopener noreferrer', text: 'Open' }));
    if (i.active && !i.tmp) acts.push(h('button', { class: 'btn line sm', type: 'button', text: 'Replace link', onclick: function () { openEdit(i); } }));
    if (!i.tmp && role === 'admin') {
      if (i.active) acts.push(h('button', { class: 'btn line sm', type: 'button', text: 'Remove', onclick: function () { askRemove(i); } }));
      else acts.push(h('button', { class: 'btn line sm', type: 'button', text: 'Restore', onclick: function () { if (flags[i.id] === 'remove') delete flags[i.id]; else flags[i.id] = 'restore'; sync(); } }));
    }
    if (i.tmp) acts.push(h('button', { class: 'btn line sm', type: 'button', text: 'Discard', onclick: function () { adds = adds.filter(function (a) { return a.tmp !== i.id; }); sync(); } }));
    else if (i._pend) acts.push(h('button', { class: 'btn line sm', type: 'button', text: 'Undo change', onclick: function () { delete edits[i.id]; delete flags[i.id]; sync(); } }));
    ul.appendChild(h('li', { class: 'item' + (i.active ? '' : ' removed') + (i._pend ? ' pend' : '') }, [
      thumbNode(i),
      h('div', { class: 'meta' }, [
        h('div', { class: 'title', dir: 'auto', text: i.title }),
        h('div', { class: 'url', text: i.url }),
        h('div', { class: 'tags' }, tags)
      ]),
      h('div', { class: 'acts' }, acts)
    ]));
  });
  show($('empty'), list.length === 0);
}
function sync() {
  render();
  var n = pendingCount();
  show($('pendingBar'), n > 0);
  $('pendingCount').textContent = n + ' unsaved change' + (n === 1 ? '' : 's');
}

/* ---------- add / replace dialog ---------- */
var titleCache = {}, fetchSeq = 0, fetched = null;   // fetched = { id, title } for the link currently in the box

function openEdit(target) {       // target = existing item to replace the link of, or nothing to add
  var kind = target ? target.kind : tab;
  dlg = { kind: kind, target: target ? target.id : null };
  $('editTitle').textContent = target ? 'Replace link' : 'Add ' + KIND_LABEL[kind].toLowerCase();
  $('fUrl').value = '';
  $('fNew').checked = false;
  var cur = serverNew(), cit = cur && findItem(cur);
  $('newHint').textContent = cit ? 'Currently: ' + (cit.title || cit.url) + '. Ticking this replaces it.' : 'No video is the New video right now.';
  show($('newRow'), !target); show($('posRow'), !target);
  $('editSave').textContent = target ? 'Replace in changes' : 'Add to changes';
  say($('fMsg'), ''); fetched = null;
  showPreview();
  $('editDlg').showModal();
  $('fUrl').focus();
}
async function getTitle(id) {
  if (titleCache[id]) return titleCache[id];
  var r = await api('/functions/v1/video-title', { method: 'POST', body: { id: id } });
  if (!r || typeof r.title !== 'string' || !r.title.trim()) throw new Error('YouTube returned no title for this video.');
  titleCache[id] = r.title.trim();
  return titleCache[id];
}
async function showPreview() {
  var box = $('preview'); clear(box); fetched = null;
  var v = $('fUrl').value.trim(), seq = ++fetchSeq;
  $('editSave').disabled = true;
  if (!v) { show(box, false); return; }
  var p = parseLink(dlg.kind, v);
  show(box, true);
  if (!p.ok) { box.appendChild(h('span', { class: 'muted small', text: p.error })); return; }
  box.appendChild(thumbNode({ platform: p.platform, external_id: p.external_id }));
  var line = h('span', { class: 'small', dir: 'auto', text: 'Reading the title from YouTube…' });
  box.appendChild(line);
  try {
    var t = await getTitle(p.external_id);
    if (seq !== fetchSeq) return;
    fetched = { id: p.external_id, title: t };
    line.textContent = 'Title (from YouTube): ' + t;
    $('editSave').disabled = false;
  } catch (e) {
    if (seq !== fetchSeq) return;
    line.textContent = 'Could not read the title: ' + e.message + ' Check that the video is public, then edit the link to try again.';
  }
}
function stageEdit(ev) {
  ev.preventDefault();
  var kind = dlg.kind, p = parseLink(kind, $('fUrl').value), msg = $('fMsg'), targetId = dlg.target;
  if (!p.ok) return say(msg, p.error, 'err');
  if (!fetched || fetched.id !== p.external_id) return say(msg, 'Wait for the title to load from YouTube.', 'err');
  var dup = sameItemElsewhere(kind, p, targetId);
  if (dup) return say(msg, 'This video is already on the site' + (dup.title ? ' ("' + dup.title + '")' : '') + '.', 'err');
  if (!targetId) {
    var all = itemsFor(kind).concat(rows.filter(function (r) { return r.kind === kind; }));
    var pos = $('editForm').elements.pos.value === 'top'
      ? Math.min.apply(null, all.map(function (x) { return x.position; }).concat([10])) - 10
      : Math.max.apply(null, all.map(function (x) { return x.position; }).concat([0])) + 10;
    var tmp = 'new-' + Date.now() + '-' + adds.length;
    adds.push({ tmp: tmp, kind: kind, external_id: p.external_id, url: p.url, title: fetched.title, position: pos });
    if ($('fNew').checked) setNew(tmp);
  } else {
    var r = rows.filter(function (x) { return x.id === targetId; })[0];
    if (!r) return say(msg, 'That video no longer exists.', 'err');
    if (p.url === r.url) return say(msg, 'That is already this video’s link.', 'err');
    edits[targetId] = { url: p.url, external_id: p.external_id, title: fetched.title };
  }
  $('editDlg').close();
  sync();
}

/* ---------- remove ---------- */
function askRemove(i) {
  rmId = i.id;
  $('rmTitle').textContent = 'Remove "' + (i.title || i.url) + '"?';
  $('rmDlg').showModal();
}

/* ---------- review & publish ---------- */
var reviewItems = [];
function lbl(i) { return i.title || i.url; }
function newNowLabel() { var c = serverNew(), it = c && findItem(c); return it ? (it.title || it.url) : 'none'; }
function buildReview() {
  reviewItems = [];
  adds.forEach(function (a) {
    reviewItems.push({ key: a.tmp, kind: a.kind, summary: [['Add ' + KIND_LABEL[a.kind].toLowerCase(), null, lbl(a) + ' — ' + a.url]],
      change: Object.assign({ op: 'add', kind: a.kind, youtube_id: a.external_id, title: a.title, position: a.position }, a.is_new ? { is_new: true } : {}), add: a });
    if (a.is_new) reviewItems[reviewItems.length - 1].summary.push(['Mark as the New video on the website', newNowLabel(), a.title]);
  });
  rows.forEach(function (r) {
    var e = edits[r.id];
    if (e) {
      var s = [];
      if (e.url) s.push(['Link', r.url, e.url]);
      if (e.title !== undefined) s.push(['Title', r.title, e.title]);
      var c = { op: 'update', id: r.id };
      if (e.url) c.youtube_id = e.external_id;
      if (e.title !== undefined) c.title = e.title;
      reviewItems.push({ key: 'e-' + r.id, id: r.id, kind: r.kind, summary: s, change: c, head: lbl(r) });
    }
    if (flags[r.id]) reviewItems.push({ key: 'f-' + r.id, id: r.id, kind: r.kind, flag: flags[r.id],
      summary: [[flags[r.id] === 'remove' ? 'Remove from website' : 'Restore to website', null, lbl(r)]], change: { op: flags[r.id], id: r.id } });
  });
  if (newPickChanged()) {
    var tgt = newPick === 'none' ? null : newPick, ti = tgt && findItem(tgt);
    if (!tgt || ti) reviewItems.push({ key: 'n-' + (tgt || 'none'), kind: tgt ? rows.filter(function (x) { return x.id === tgt; })[0].kind : 'video', isNewOp: true, id: tgt,
      summary: [[tgt ? 'Mark as the New video on the website' : 'Show no New video on the website', newNowLabel(), tgt ? lbl(ti) : 'none']],
      change: tgt ? { op: 'set_new', id: tgt } : { op: 'clear_new' } });
  }
  // the New-video change goes last so it sees restores/other edits from the same batch
  reviewItems.sort(function (x, y) { return (x.isNewOp ? 1 : 0) - (y.isNewOp ? 1 : 0); });
}
function openReview() {
  buildReview(); say($('rMsg'), '');
  var ul = $('reviewList'); clear(ul);
  reviewItems.forEach(function (it, n) {
    var d = h('div', { class: 'diff', dir: 'auto' });
    d.appendChild(h('b', { text: it.isNewOp ? 'New video section' : KIND_LABEL[it.kind] + (it.head ? ': ' + it.head : '') }));
    it.summary.forEach(function (s) {
      var line = h('div'); line.appendChild(document.createTextNode(s[0] + ': '));
      if (s[1] != null) { line.appendChild(h('del', { text: String(s[1] == null ? '' : s[1]) })); line.appendChild(document.createTextNode(' → ')); }
      line.appendChild(h('ins', { text: String(s[2] == null ? '' : s[2]) }));
      d.appendChild(line);
    });
    var cb = h('input', { type: 'checkbox', checked: 'checked', 'aria-label': 'Include this change', 'data-n': String(n) });
    ul.appendChild(h('li', {}, [cb, d]));
  });
  $('rConfirm').disabled = false;
  $('reviewDlg').showModal();
}
async function publish() {
  var picked = [];
  Array.prototype.forEach.call($('reviewList').querySelectorAll('input'), function (cb) { if (cb.checked) picked.push(reviewItems[+cb.dataset.n]); });
  if (!picked.length) return say($('rMsg'), 'No changes are ticked. Tick at least one, or press Back.', 'err');
  $('rConfirm').disabled = true; say($('rMsg'), 'Publishing…');
  try {
    await api('/rest/v1/rpc/iufu_apply_changes', { method: 'POST', body: { changes: picked.map(function (p) { return p.change; }) } });
  } catch (e) {
    $('rConfirm').disabled = false;
    return say($('rMsg'), 'Not published. ' + e.message + ' No changes were saved.', 'err');
  }
  // The server accepted the batch. Re-read it and verify, rather than assuming.
  var problems = [];
  try { await loadRows(); } catch (e) { problems.push('could not re-read the data (' + e.message + ')'); }
  if (!problems.length) picked.forEach(function (p) {
    var c = p.change, r;
    if (c.op === 'add') r = rows.filter(function (x) { return x.kind === c.kind && x.external_id === c.youtube_id && x.active; })[0];
    else if (c.op === 'clear_new') r = {};
    else r = rows.filter(function (x) { return x.id === c.id; })[0];
    var ok = !!r;
    if (ok && c.op === 'add' && c.is_new) ok = r.isNew && rows.filter(function (x) { return x.isNew; }).length === 1;
    if (ok && c.op === 'set_new') ok = r.isNew && rows.filter(function (x) { return x.isNew; }).length === 1;
    if (ok && c.op === 'clear_new') ok = rows.filter(function (x) { return x.isNew; }).length === 0;
    if (ok && c.op === 'update') { if ('youtube_id' in c && r.external_id !== c.youtube_id) ok = false; if ('title' in c && r.title !== c.title) ok = false; }
    if (ok && c.op === 'remove') ok = !r.active;
    if (ok && c.op === 'restore') ok = r.active;
    if (!ok) problems.push(p.summary[0][0]);
  });
  picked.forEach(function (p) {
    if (p.add) adds = adds.filter(function (a) { return a.tmp !== p.key; });
    else if (p.key.charAt(0) === 'e') delete edits[p.id];
    else if (p.key.charAt(0) === 'f') delete flags[p.id];
    else if (p.isNewOp) newPick = undefined;
  });
  $('reviewDlg').close(); sync();
  if (problems.length) banner('Saved on the server, but could not verify: ' + problems.join('; ') + '. Reload to check.', 'err');
  else banner('Published ' + picked.length + ' change' + (picked.length === 1 ? '' : 's') + ' and verified them on the server. The public site shows them on its next page load.', 'ok');
}
function banner(t, c) { say($('banner'), t, c); if (t) window.scrollTo(0, 0); }

/* ---------- data ---------- */
async function loadRows() {
  rows = (await api('/rest/v1/videos?select=id,kind,youtube_id,title,category,position,published,featured,created_at&order=kind.asc,position.asc,created_at.asc') || []).map(norm);
}
async function loadAudit() {
  var body = $('auditBody'); clear(body);
  var data;
  try { data = await api('/rest/v1/audit_log?select=*&table_name=in.(videos,daily_hadith,banner_settings)&order=id.desc&limit=200'); }
  catch (e) { body.appendChild(h('tr', {}, [h('td', { colspan: '5', text: 'Could not load the audit log: ' + e.message })])); return; }
  (data || []).forEach(function (a) {
    var n = a.new_data || {}, o = a.old_data || {}, ch = [], act = a.operation;
    if (a.table_name === 'banner_settings') {
      body.appendChild(h('tr', {}, [
        h('td', { text: new Date(a.created_at).toLocaleString('en-GB') }),
        h('td', { text: a.actor_email || (a.actor ? 'admin' : 'system') }),
        h('td', { text: 'BANNER SPEED' }),
        h('td', { text: 'Hadith banner' }),
        h('td', { text: 'speed: ' + (o.hadith_speed == null ? '' : o.hadith_speed) + ' → ' + (n.hadith_speed == null ? '' : n.hadith_speed) })
      ]));
      return;
    }
    if (a.table_name === 'daily_hadith') {
      if (act === 'UPDATE' && o.published === true && n.published === false) act = 'HADITH REMOVED';
      else if (act === 'UPDATE' && o.published === false && n.published === true) act = 'HADITH RESTORED';
      else act = act === 'INSERT' ? 'HADITH ADDED' : 'HADITH EDITED';
      if (a.operation === 'INSERT') ch.push('date: ' + n.show_date, 'text: ' + n.text);
      else ['show_date', 'text', 'source'].forEach(function (k) { if (o[k] !== n[k]) ch.push(k + ': ' + (o[k] == null ? '' : o[k]) + ' → ' + (n[k] == null ? '' : n[k])); });
      body.appendChild(h('tr', {}, [
        h('td', { text: new Date(a.created_at).toLocaleString('en-GB') }),
        h('td', { text: a.actor_email || (a.actor ? 'admin' : 'system') }),
        h('td', { text: act }),
        h('td', { dir: 'auto', text: 'Hadith ' + (n.show_date || o.show_date || '') }),
        h('td', { text: ch.join('\n') })
      ]));
      return;
    }
    if (act === 'UPDATE') {
      if (o.published === true && n.published === false) act = 'REMOVED';
      else if (o.published === false && n.published === true) act = 'RESTORED';
      if (o.featured !== n.featured && o.published !== false && n.published !== false) act = n.featured ? 'MARKED NEW' : 'UNMARKED NEW';
      ['youtube_id', 'title', 'category'].forEach(function (k) { if (o[k] !== n[k]) ch.push(k + ': ' + (o[k] == null ? '' : o[k]) + ' → ' + (n[k] == null ? '' : n[k])); });
    } else if (act === 'INSERT') ch.push('youtube_id: ' + (n.youtube_id || ''));
    body.appendChild(h('tr', {}, [
      h('td', { text: new Date(a.created_at).toLocaleString('en-GB') }),
      h('td', { text: a.actor_email || (a.actor ? 'admin' : 'system') }),
      h('td', { text: act }),
      h('td', { dir: 'auto', text: n.title || o.title || a.record_id || '' }),
      h('td', { text: ch.join('\n') })
    ]));
  });
}

/* ---------- daily Hadith (shown as a rolling banner in the website header) ---------- */
var hrows = [], hEdit = null, hStage = null, hSpeed = 3, hSpeedSaved = 3;
var SPEED_MULT = [1.2, 1.8, 2.4, 4, 7];
function demoSpeed() {
  // Same rule the website uses, so this preview matches what visitors will see.
  var v = +$('hSpeed').value || 3, t = todayStr(), now = hrows.filter(function (r) { return r.published && r.show_date <= t; })[0];
  var text = now ? now.text + (now.source ? ' — ' + now.source : '') : 'مثال: هكذا سيظهر الحديث متحركًا في أعلى الموقع — متفق عليه';
  var one = '✦ ' + text + '    ', d = $('hDemo');
  if (d.dataset.txt !== text) { d.dataset.txt = text; d.textContent = one + one; }
  var secs = Math.max(3, Math.min(240, Math.round(Math.max(24, Math.min(120, text.length * 0.45)) / SPEED_MULT[v - 1])));
  d.style.animationDuration = secs + 's';
  $('hDemoNote').textContent = 'Preview: each Hadith takes about ' + secs + ' seconds at speed ' + v + (now ? ' (using the Hadith showing now).' : ' (sample text, no Hadith is showing yet).');
}
function todayStr() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
async function loadHadith() {
  hrows = await api('/rest/v1/daily_hadith?select=id,show_date,text,source,published&order=show_date.desc&limit=400') || [];
  var bs = await api('/rest/v1/banner_settings?select=hadith_speed&limit=1');
  hSpeedSaved = (bs && bs[0] && bs[0].hadith_speed) || 3;
}
function hStatus(r, nowId) {
  if (!r.published) return 'Removed';
  if (r.id === nowId) return 'Showing now';
  return r.show_date > todayStr() ? 'Scheduled' : 'In the banner';
}
// Same day number the website uses to pick the "Hadith of the day".
function dayNo() { var d = new Date(); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }

/* ---------- prepared series (hadith-series.js): add all of it in one reviewed step ---------- */
var hsStage = null;
function hSeriesItems() {
  var S2 = window.IUFU_HADITH_SERIES, have = {};
  if (!S2 || !Array.isArray(S2.items)) return [];
  hrows.forEach(function (r) { have[r.text] = 1; });
  return S2.items.filter(function (x) { return x && typeof x.text === 'string' && x.text.length >= 10 && x.text.length <= 600 && !have[x.text]; });
}
function hSeriesButton() {
  var n = hSeriesItems().length, b = $('hSeries');
  b.textContent = 'Add the prepared series (' + n + ')'; show(b, n > 0);
}
function openSeries() {
  var items = hSeriesItems(); if (!items.length) return;
  // Dates: the free dates counting back from today, so every Hadith joins the banner at once, in series order.
  var used = {}, dates = [], d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  hrows.forEach(function (r) { used[r.show_date] = 1; });
  for (var i = 0; dates.length < items.length && i < 3000; i++) {
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if (!used[s]) dates.push(s);
    d.setDate(d.getDate() - 1);
  }
  dates.reverse();
  hsStage = items.map(function (x, k) { return { show_date: dates[k], text: x.text, source: (x.source || '').slice(0, 120) }; });
  $('hsIntro').textContent = hsStage.length + ' Hadiths (' + ((window.IUFU_HADITH_SERIES || {}).name || '') + ') will be added and will start rotating in the website banner. Dates ' + dates[0] + ' to ' + dates[dates.length - 1] + ' are used only to keep the order. Hadiths already in the list are skipped. Nothing is saved until you confirm.';
  var box = $('hsList'); clear(box);
  hsStage.forEach(function (x, k) { box.appendChild(h('div', {}, [document.createTextNode((k + 1) + '. ' + x.text), h('small', { text: '— ' + x.source })])); });
  say($('hsMsg'), ''); $('hsYes').disabled = false; $('hsDlg').showModal();
}
async function saveSeries() {
  var m = $('hsMsg'), want = hsStage; $('hsYes').disabled = true; say(m, 'Saving…');
  var saved;
  try { saved = await api('/rest/v1/daily_hadith', { method: 'POST', body: want, prefer: 'return=representation' }); }
  catch (e) {
    $('hsYes').disabled = false;
    var msg = e.status === 409 || /duplicate key/i.test(e.message) ? 'One of the dates is already used. Reload the page and try again.' : e.message;
    return say(m, 'Not saved. ' + msg + ' Nothing was changed.', 'err');
  }
  var ok = Array.isArray(saved) && saved.length === want.length;
  try { await loadHadith(); } catch (e) { ok = false; }
  var have = {}; hrows.forEach(function (r) { have[r.text + '|' + r.show_date] = 1; });
  ok = ok && want.every(function (x) { return have[x.text + '|' + x.show_date]; });
  $('hsDlg').close(); renderHadith();
  if (ok) banner(want.length + ' Hadiths saved and verified on the server. They rotate in the website banner on its next page load.', 'ok');
  else banner('The server did not confirm every Hadith was saved. Reload and check the list before trying again.', 'err');
}
async function saveSpeed() {
  var want = +$('hSpeed').value, btn = $('hSpeedSave'); btn.disabled = true;
  try {
    var res = await api('/rest/v1/banner_settings?id=eq.true', { method: 'PATCH', body: { hadith_speed: want }, prefer: 'return=representation' });
    if (!Array.isArray(res) || res.length !== 1 || res[0].hadith_speed !== want) throw new Error('The server did not confirm the change.');
    hSpeedSaved = want;
    banner('Banner speed set to ' + want + ' and verified on the server. The website uses it on its next page load.', 'ok');
  } catch (e) { banner('Speed not changed. ' + e.message, 'err'); }
  btn.disabled = false;
}
function renderHadith() {
  $('hSpeed').value = String(hSpeedSaved); demoSpeed();
  var t = todayStr(), live = hrows.filter(function (r) { return r.published && r.show_date <= t; });
  var now = live.length ? live.slice().sort(function (a, b) { return a.show_date < b.show_date ? -1 : 1; })[dayNo() % live.length] : null;
  $('hNow').textContent = now ? '★ ' + live.length + ' Hadith' + (live.length === 1 ? '' : 's') + ' rotating in the website banner. Hadith of the day: ' + now.text + (now.source ? ' — ' + now.source : '') : 'No Hadith is showing on the website right now.';
  hSeriesButton();
  var ul = $('hList'); clear(ul);
  hrows.forEach(function (r) {
    var st = hStatus(r, now && now.id);
    var acts = [h('button', { class: 'btn line sm', type: 'button', text: 'Edit', onclick: function () { openHadith(r); } })];
    acts.push(h('button', { class: 'btn line sm', type: 'button', text: r.published ? 'Remove' : 'Restore', onclick: function () { askHadithToggle(r); } }));
    ul.appendChild(h('li', { class: 'item hitem' + (r.published ? '' : ' removed') }, [
      h('div', { class: 'hdate', text: r.show_date }),
      h('div', { class: 'meta' }, [
        h('div', { class: 'title', dir: 'auto', text: r.text }),
        h('div', { class: 'url', dir: 'auto', text: r.source || '' }),
        h('div', { class: 'tags' }, [h('span', { class: 'tag' + (st === 'Showing now' ? ' gold' : ''), text: st })])
      ]),
      h('div', { class: 'acts' }, acts)
    ]));
  });
  show($('hEmpty'), hrows.length === 0);
}
function nextFreeDate() {
  var d = new Date(), used = {};
  hrows.forEach(function (r) { used[r.show_date] = 1; });
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  for (var i = 0; i < 800; i++) {
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if (!used[s]) return s;
    d.setDate(d.getDate() + 1);
  }
  return todayStr();
}
function openHadith(r) {
  hEdit = r || null; hStage = null;
  $('hTitle').textContent = r ? 'Edit Hadith' : 'Add Hadith';
  $('hDate').value = r ? r.show_date : nextFreeDate();
  $('hText').value = r ? r.text : '';
  $('hSource').value = r ? (r.source || '') : '';
  say($('hMsg'), ''); hStep(1); hPreview();
  $('hDlg').showModal(); $('hText').focus();
}
function hStep(n) {
  show($('hForm1'), n === 1); show($('hForm2'), n === 2);
}
function hPreview() {
  var t = $('hText').value.trim(), s = $('hSource').value.trim();
  $('hPrev').textContent = t ? '✦ ' + t + (s ? ' — ' + s : '') : 'The Hadith will appear here as it rolls across the website header.';
  $('hCount').textContent = $('hText').value.length + ' / 600';
}
function hReview(ev) {
  ev.preventDefault();
  var d = $('hDate').value, t = $('hText').value.trim(), s = $('hSource').value.trim(), m = $('hMsg');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return say(m, 'Choose the date this Hadith should appear.', 'err');
  if (t.length < 10) return say(m, 'The Hadith text is too short (at least 10 characters).', 'err');
  if (t.length > 600) return say(m, 'The Hadith text is too long (maximum 600 characters).', 'err');
  if (s.length > 120) return say(m, 'The source is too long (maximum 120 characters).', 'err');
  var clash = hrows.filter(function (r) { return r.show_date === d && (!hEdit || r.id !== hEdit.id); })[0];
  if (clash) return say(m, 'There is already a Hadith for ' + d + '. Edit that one, or choose another date.', 'err');
  hStage = { show_date: d, text: t, source: s };
  var box = $('hSummary'); clear(box);
  var rows2 = hEdit
    ? [['Date', hEdit.show_date, d], ['Text', hEdit.text, t], ['Source', hEdit.source || '', s]].filter(function (x) { return x[1] !== x[2]; })
    : [['Add Hadith for', null, d], ['Text', null, t], ['Source', null, s || '(none)']];
  if (!rows2.length) return say(m, 'Nothing has changed.', 'err');
  rows2.forEach(function (x) {
    var line = h('div', { class: 'diff', dir: 'auto' }); line.appendChild(document.createTextNode(x[0] + ': '));
    if (x[1] != null) { line.appendChild(h('del', { text: x[1] || '(empty)' })); line.appendChild(document.createTextNode(' → ')); }
    line.appendChild(h('ins', { text: x[2] })); box.appendChild(line);
  });
  say(m, ''); hStep(2);
}
async function hSave() {
  var m = $('hMsg'); $('hConfirm').disabled = true; say(m, 'Saving…');
  var saved;
  try {
    if (hEdit) saved = await api('/rest/v1/daily_hadith?id=eq.' + encodeURIComponent(hEdit.id), { method: 'PATCH', body: hStage, prefer: 'return=representation' });
    else saved = await api('/rest/v1/daily_hadith', { method: 'POST', body: hStage, prefer: 'return=representation' });
  } catch (e) {
    $('hConfirm').disabled = false;
    var msg = e.status === 409 || /duplicate key/i.test(e.message) ? 'There is already a Hadith for that date.' : e.message;
    return say(m, 'Not saved. ' + msg + ' Nothing was changed.', 'err');
  }
  var ok = Array.isArray(saved) && saved.length === 1 && saved[0].text === hStage.text && saved[0].show_date === hStage.show_date && (saved[0].source || '') === hStage.source;
  try { await loadHadith(); } catch (e) { ok = false; }
  var back = hrows.filter(function (r) { return r.text === hStage.text && r.show_date === hStage.show_date; })[0];
  $('hConfirm').disabled = false; $('hDlg').close(); renderHadith();
  if (ok && back) banner('Hadith saved and verified on the server. The website shows it on its next page load (on its date).', 'ok');
  else banner('The server did not confirm the Hadith was saved. Reload and check before trying again.', 'err');
}
var hToggle = null;
function askHadithToggle(r) {
  hToggle = r;
  $('hrTitle').textContent = (r.published ? 'Remove' : 'Restore') + ' the Hadith for ' + r.show_date + '?';
  $('hrText').textContent = r.published ? 'It will stop appearing on the website. You can restore it later.' : 'It will appear on the website again on its date.';
  $('hrYes').textContent = r.published ? 'Remove from site' : 'Restore';
  $('hrDlg').showModal();
}
async function doHadithToggle() {
  var r = hToggle, want = !r.published; $('hrYes').disabled = true;
  try {
    var res = await api('/rest/v1/daily_hadith?id=eq.' + encodeURIComponent(r.id), { method: 'PATCH', body: { published: want }, prefer: 'return=representation' });
    if (!Array.isArray(res) || res.length !== 1 || res[0].published !== want) throw new Error('The server did not confirm the change.');
    await loadHadith(); $('hrDlg').close(); renderHadith();
    banner('Hadith for ' + r.show_date + (want ? ' restored' : ' removed') + ' and verified on the server.', 'ok');
  } catch (e) { $('hrDlg').close(); banner('Not changed. ' + e.message, 'err'); }
  $('hrYes').disabled = false;
}

/* ---------- sign in / out ---------- */
var fails = [];
async function signIn(ev) {
  ev.preventDefault();
  var msg = $('loginMsg'), now = Date.now();
  fails = fails.filter(function (t) { return now - t < 60000; });
  if (fails.length >= 5) return say(msg, 'Too many attempts. Wait a minute and try again.', 'err');
  $('loginBtn').disabled = true; say(msg, '');
  try {
    var j = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: $('email').value.trim(), password: $('password').value } });
    setSession(j); $('password').value = '';
    await start();
  } catch (e) {
    fails.push(Date.now());
    say(msg, e.status === 400 ? 'Sign-in failed. Check your email and password.' : (e.status === 429 ? 'Too many attempts. Please wait and try again.' : e.message), 'err');
  }
  $('loginBtn').disabled = false;
}
async function signOut(message) {
  var tok = S && S.access;
  S = null; role = null; saveSession(); rows = []; hrows = []; edits = {}; flags = {}; adds = []; newPick = undefined;
  if (tok) { try { await raw('/auth/v1/logout', { method: 'POST', token: tok }); } catch (e) {} }
  show($('app'), false); show($('login'), true);
  say($('loginMsg'), message || '', message ? 'err' : '');
  if (message && /signed out/i.test(message)) $('loginMsg').className = 'msg ok';
}
async function start() {
  try {
    var me = await api('/rest/v1/admins?select=user_id,display_name');
    if (!me || !me.length) { await signOut('This account is not authorised to use the console.'); return; }
    role = 'admin';
    await loadRows();
    try { await loadHadith(); } catch (e) { hrows = []; }
  } catch (e) {
    if (S) await signOut('Could not load the console: ' + e.message);
    return;
  }
  $('who').textContent = S.email;
  show($('auditTab'), true);
  show($('login'), false); show($('app'), true);
  sync(); renderHadith(); idle();
}

/* ---------- idle sign-out (30 min) ---------- */
var idleT;
function idle() { clearTimeout(idleT); idleT = setTimeout(function () { if (S) signOut('You were signed out after 30 minutes of inactivity.'); }, 30 * 60 * 1000); }
['click', 'keydown', 'touchstart'].forEach(function (t) { document.addEventListener(t, function () { if (S) idle(); }, { passive: true }); });

/* ---------- wiring ---------- */
function init() {
  if (!CFG.url || !CFG.key) { show($('login'), true); say($('loginMsg'), 'The console is not configured (supabase-config.js is missing the project URL or key).', 'err'); $('loginBtn').disabled = true; return; }
  $('loginForm').addEventListener('submit', signIn);
  $('logout').addEventListener('click', function () { signOut('You have been signed out.'); });
  $('q').addEventListener('input', render);
  $('status').addEventListener('change', render);
  $('addBtn').addEventListener('click', function () { openEdit(null); });
  $('fUrl').addEventListener('input', showPreview);
  $('editForm').addEventListener('submit', stageEdit);
  $('editCancel').addEventListener('click', function () { $('editDlg').close(); });
  $('rmNo').addEventListener('click', function () { $('rmDlg').close(); });
  $('rmYes').addEventListener('click', function () { flags[rmId] = 'remove'; $('rmDlg').close(); sync(); });
  $('hAdd').addEventListener('click', function () { openHadith(null); });
  $('hSeries').addEventListener('click', openSeries);
  $('hsNo').addEventListener('click', function () { $('hsDlg').close(); });
  $('hsYes').addEventListener('click', saveSeries);
  $('hSpeed').addEventListener('change', demoSpeed);
  $('hSpeedSave').addEventListener('click', saveSpeed);
  $('hForm1').addEventListener('submit', hReview);
  $('hText').addEventListener('input', hPreview); $('hSource').addEventListener('input', hPreview);
  $('hCancel').addEventListener('click', function () { $('hDlg').close(); });
  $('hBack').addEventListener('click', function () { hStep(1); say($('hMsg'), ''); });
  $('hConfirm').addEventListener('click', hSave);
  $('hrNo').addEventListener('click', function () { $('hrDlg').close(); });
  $('hrYes').addEventListener('click', doHadithToggle);
  $('reviewBtn').addEventListener('click', openReview);
  $('rCancel').addEventListener('click', function () { $('reviewDlg').close(); });
  $('rConfirm').addEventListener('click', publish);
  $('discardAll').addEventListener('click', function () { if (confirm('Discard all unsaved changes?')) { edits = {}; flags = {}; adds = []; newPick = undefined; sync(); } });
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-kind]'); if (!b) return;
    Array.prototype.forEach.call($('tabs').children, function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    var k = b.dataset.kind, isAudit = k === 'audit', isH = k === 'hadith';
    show($('listView'), !isAudit && !isH); show($('auditView'), isAudit); show($('hadithView'), isH);
    if (isAudit) loadAudit(); else if (isH) { renderHadith(); } else { tab = k; $('q').value = ''; render(); }
  });
  window.addEventListener('beforeunload', function (e) { if (pendingCount()) { e.preventDefault(); e.returnValue = ''; } });
  loadSession();
  if (S) start(); else show($('login'), true);
}
init();
})();
