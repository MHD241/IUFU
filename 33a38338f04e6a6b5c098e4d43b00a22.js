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
    title: r.title, category: r.category, position: r.position, active: !!r.published, created: r.created_at };
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

function eff(r) {            // row with pending edits applied
  var e = edits[r.id], o = {}, k;
  for (k in r) o[k] = r[k];
  if (e) for (k in e) o[k] = e[k];
  if (flags[r.id] === 'remove') o.active = false;
  if (flags[r.id] === 'restore') o.active = true;
  return o;
}
function pendingCount() { return adds.length + Object.keys(edits).length + Object.keys(flags).length; }
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
  var ul = $('list'); clear(ul);
  list.forEach(function (i) {
    var tags = [h('span', { class: 'tag', text: i.category || DEFAULT_CAT, dir: 'auto' })];
    if (i.active) {
      var r = liveRank[i.id];
      tags.push(h('span', { class: 'tag', text: kind === 'video' ? (r <= 4 ? 'Homepage slot ' + r : 'Not shown (only first 4)') : 'Position ' + r }));
    } else tags.push(h('span', { class: 'tag', text: 'Removed from site' }));
    if (i._pend) tags.push(h('span', { class: 'tag gold', text: i.tmp ? 'New, not saved' : 'Changed, not saved' }));
    var acts = [];
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

function replaceTargets(kind) {   // live, saved items of this section that can be replaced
  return itemsFor(kind).filter(function (x) { return x.active && !x.tmp; });
}
function openEdit(target) {
  var kind = target ? target.kind : tab;
  dlg = { kind: kind };
  $('editTitle').textContent = 'Add ' + KIND_LABEL[kind].toLowerCase();
  $('fUrl').value = '';
  var sel = $('fTarget'); clear(sel);
  var list = replaceTargets(kind), rank = 0;
  list.forEach(function (x) { rank++; sel.appendChild(h('option', { value: x.id, text: '#' + rank + '  ' + (x.title || x.url) })); });
  $('fReplace').disabled = !list.length;
  $('fReplace').checked = !!target && list.length > 0;
  if (target) sel.value = target.id;
  say($('fMsg'), ''); fetched = null;
  syncDialog(); showPreview();
  $('editDlg').showModal();
  $('fUrl').focus();
}
function syncDialog() {
  var rep = $('fReplace').checked;
  show($('replaceRow'), rep); show($('posRow'), !rep);
  $('editSave').textContent = rep ? 'Replace in changes' : 'Add to changes';
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
  var kind = dlg.kind, p = parseLink(kind, $('fUrl').value), msg = $('fMsg'), rep = $('fReplace').checked;
  if (!p.ok) return say(msg, p.error, 'err');
  if (!fetched || fetched.id !== p.external_id) return say(msg, 'Wait for the title to load from YouTube.', 'err');
  var targetId = rep ? $('fTarget').value : null;
  var dup = sameItemElsewhere(kind, p, targetId);
  if (dup) return say(msg, 'This video is already on the site' + (dup.title ? ' ("' + dup.title + '")' : '') + '.', 'err');
  if (!rep) {
    var all = itemsFor(kind).concat(rows.filter(function (r) { return r.kind === kind; }));
    var pos = $('editForm').elements.pos.value === 'top'
      ? Math.min.apply(null, all.map(function (x) { return x.position; }).concat([10])) - 10
      : Math.max.apply(null, all.map(function (x) { return x.position; }).concat([0])) + 10;
    adds.push({ tmp: 'new-' + Date.now() + '-' + adds.length, kind: kind, external_id: p.external_id, url: p.url, title: fetched.title, position: pos });
  } else {
    var r = rows.filter(function (x) { return x.id === targetId; })[0];
    if (!r) return say(msg, 'Pick the video to replace.', 'err');
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
function buildReview() {
  reviewItems = [];
  adds.forEach(function (a) {
    reviewItems.push({ key: a.tmp, kind: a.kind, summary: [['Add ' + KIND_LABEL[a.kind].toLowerCase(), null, lbl(a) + ' — ' + a.url]],
      change: { op: 'add', kind: a.kind, youtube_id: a.external_id, title: a.title, position: a.position }, add: a });
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
}
function openReview() {
  buildReview(); say($('rMsg'), '');
  var ul = $('reviewList'); clear(ul);
  reviewItems.forEach(function (it, n) {
    var d = h('div', { class: 'diff', dir: 'auto' });
    d.appendChild(h('b', { text: KIND_LABEL[it.kind] + (it.head ? ': ' + it.head : '') }));
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
    else r = rows.filter(function (x) { return x.id === c.id; })[0];
    var ok = !!r;
    if (ok && c.op === 'update') { if ('youtube_id' in c && r.external_id !== c.youtube_id) ok = false; if ('title' in c && r.title !== c.title) ok = false; }
    if (ok && c.op === 'remove') ok = !r.active;
    if (ok && c.op === 'restore') ok = r.active;
    if (!ok) problems.push(p.summary[0][0]);
  });
  picked.forEach(function (p) {
    if (p.add) adds = adds.filter(function (a) { return a.tmp !== p.key; });
    else if (p.key.charAt(0) === 'e') delete edits[p.id];
    else if (p.key.charAt(0) === 'f') delete flags[p.id];
  });
  $('reviewDlg').close(); sync();
  if (problems.length) banner('Saved on the server, but could not verify: ' + problems.join('; ') + '. Reload to check.', 'err');
  else banner('Published ' + picked.length + ' change' + (picked.length === 1 ? '' : 's') + ' and verified them on the server. The public site shows them on its next page load.', 'ok');
}
function banner(t, c) { say($('banner'), t, c); if (t) window.scrollTo(0, 0); }

/* ---------- data ---------- */
async function loadRows() {
  rows = (await api('/rest/v1/videos?select=id,kind,youtube_id,title,category,position,published,created_at&order=kind.asc,position.asc,created_at.asc') || []).map(norm);
}
async function loadAudit() {
  var body = $('auditBody'); clear(body);
  var data;
  try { data = await api('/rest/v1/audit_log?select=*&table_name=eq.videos&order=id.desc&limit=200'); }
  catch (e) { body.appendChild(h('tr', {}, [h('td', { colspan: '5', text: 'Could not load the audit log: ' + e.message })])); return; }
  (data || []).forEach(function (a) {
    var n = a.new_data || {}, o = a.old_data || {}, ch = [], act = a.operation;
    if (act === 'UPDATE') {
      if (o.published === true && n.published === false) act = 'REMOVED';
      else if (o.published === false && n.published === true) act = 'RESTORED';
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
  S = null; role = null; saveSession(); rows = []; edits = {}; flags = {}; adds = [];
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
  } catch (e) {
    if (S) await signOut('Could not load the console: ' + e.message);
    return;
  }
  $('who').textContent = S.email;
  show($('auditTab'), true);
  show($('login'), false); show($('app'), true);
  sync(); idle();
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
  $('fReplace').addEventListener('change', syncDialog);
  $('editForm').addEventListener('submit', stageEdit);
  $('editCancel').addEventListener('click', function () { $('editDlg').close(); });
  $('rmNo').addEventListener('click', function () { $('rmDlg').close(); });
  $('rmYes').addEventListener('click', function () { flags[rmId] = 'remove'; $('rmDlg').close(); sync(); });
  $('reviewBtn').addEventListener('click', openReview);
  $('rCancel').addEventListener('click', function () { $('reviewDlg').close(); });
  $('rConfirm').addEventListener('click', publish);
  $('discardAll').addEventListener('click', function () { if (confirm('Discard all unsaved changes?')) { edits = {}; flags = {}; adds = []; sync(); } });
  $('tabs').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-kind]'); if (!b) return;
    Array.prototype.forEach.call($('tabs').children, function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
    var k = b.dataset.kind, isAudit = k === 'audit';
    show($('listView'), !isAudit); show($('auditView'), isAudit);
    if (isAudit) loadAudit(); else { tab = k; $('q').value = ''; render(); }
  });
  window.addEventListener('beforeunload', function (e) { if (pendingCount()) { e.preventDefault(); e.returnValue = ''; } });
  loadSession();
  if (S) start(); else show($('login'), true);
}
init();
})();
