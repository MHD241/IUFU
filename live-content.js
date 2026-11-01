/* Loads the live episode/short lists from the IUFyou database (read-only: the database only
   returns published rows to the public), then starts the page.
   - Does nothing unless supabase-config.js sets  live: true.
   - If the database is unreachable, slow, or returns anything unexpected, the page starts with the
     built-in lists from content.js instead, so visitors never see an empty site.
   - Instagram/Facebook posts are not managed by the dashboard and always come from content.js. */
(function () {
  var C = window.IUFU_CFG || {}, started = false;
  var YT = /^[A-Za-z0-9_-]{11}$/;

  function boot() { if (started) return; started = true; if (window.__iufuBoot) window.__iufuBoot(); }

  function fetchLive() {
    if (C.live !== true || !C.url || !C.key || !window.fetch || !window.AbortController) return Promise.resolve(null);
    var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, 3500);
    return fetch(C.url + '/rest/v1/videos?select=kind,youtube_id,title,position,featured&published=eq.true&order=position.asc,created_at.asc',
      { headers: { apikey: C.key }, signal: ac.signal, cache: 'no-store' })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('http'); return r.json(); })
      .catch(function () { clearTimeout(t); return null; });
  }

  function apply(rows) {
    if (!Array.isArray(rows)) return;
    var v = [], s = [], nw = null;
    rows.forEach(function (r) {
      if (r && (r.kind === 'video' || r.kind === 'short') && YT.test(r.youtube_id || '') && typeof r.title === 'string' && r.title)
        (r.kind === 'video' ? v : s).push({ id: r.youtube_id, t: r.title });
      if (r && r.featured === true && !nw && (r.kind === 'video' || r.kind === 'short') && YT.test(r.youtube_id || '') && r.title)
        nw = { id: r.youtube_id, t: r.title, kind: r.kind };
    });
    // Only trust the live data if it clearly contains both main sections.
    if (!v.length || !s.length) return;
    window.SITE.videos = v; window.SITE.shorts = s; window.SITE.newVideo = nw;
  }

  var ready = new Promise(function (res) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', res); else res();
  });
  Promise.all([ready, fetchLive()]).then(function (r) { try { apply(r[1]); } catch (e) {} boot(); });
})();
