// Supabase Edge Function: video-title
// Returns the real title of a public YouTube video so admins never type titles.
// Deploy with verify_jwt = false: this function does its own check and answers only
// signed-in admins (it asks the database, using the caller's own token, via is_iufu_admin()).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { message: 'Use POST.' });

  // 1. Only admins. The database decides, using the caller's token.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json(401, { message: 'Sign in first.' });
  let isAdmin = false;
  try {
    const r = await fetch(Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/is_iufu_admin', {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY'), Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    isAdmin = r.ok && (await r.json()) === true;
  } catch (_) { /* fall through: treated as not admin */ }
  if (!isAdmin) return json(403, { message: 'Not authorised.' });

  // 2. Validate input. Only the fixed YouTube host is ever contacted.
  let id = '';
  try { id = String((await req.json()).id || ''); } catch (_) {}
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json(400, { message: 'That is not a valid YouTube video ID.' });

  // 3. Ask YouTube.
  try {
    const url = 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.status === 404 || r.status === 401 || r.status === 400)
      return json(404, { message: 'YouTube could not find this video, or it is private or not embeddable.' });
    if (!r.ok) return json(502, { message: 'YouTube did not answer (HTTP ' + r.status + '). Try again.' });
    const title = String((await r.json()).title || '').trim().slice(0, 300);
    if (!title) return json(502, { message: 'YouTube returned no title for this video.' });
    return json(200, { title });
  } catch (_) {
    return json(502, { message: 'Could not reach YouTube. Try again.' });
  }
}

Deno.serve(handler);
