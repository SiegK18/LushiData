import { VERSION, MODEL, PROMPT_VERSION, TASK_CLASSIFICATION, TASK_DETECTION, promptVersion, validBox, makeAnnotationPrompt } from './core.js';
const PAGE = "__PAGE__";
const security = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=()', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site https://*.openai.com"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...security, 'Content-Type': 'application/json; charset=utf-8' } });
const rate = new Map();
export function validateInput(body) {
  if (body?.task !== undefined && ![TASK_CLASSIFICATION,TASK_DETECTION].includes(body.task)) throw new Error('Type de dataset inconnu.');
  if (!body || !Array.isArray(body.classes) || body.classes.length < 2 || body.classes.length > 8 || body.classes.some(c => typeof c !== 'string' || !c.trim() || c.length > 40 || /[\r\n<>]/.test(c) || c === 'indéterminé') || new Set(body.classes).size !== body.classes.length) throw new Error('Définis entre 2 et 8 catégories distinctes (40 caractères maximum).');
  if (!Array.isArray(body.frames) || body.frames.length < 1 || body.frames.length > 4) throw new Error('Une requête doit contenir entre 1 et 4 images.');
  if (body.task === TASK_DETECTION && body.frames.length !== 1) throw new Error('La détection multi-objets traite une image à la fois.');
  const ids = new Set();
  for (const f of body.frames) {
    if (!f || typeof f.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(f.id) || ids.has(f.id) || typeof f.data !== 'string' || f.data.length > 700_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(f.data)) throw new Error('Image JPEG invalide, trop volumineuse ou identifiant dupliqué.');
    const data = f.data.split(',')[1];
    if (!data.startsWith('/9j/') || data.length % 4 !== 0) throw new Error('Image JPEG invalide.');
    ids.add(f.id);
  }
  return body;
}
export function makePrompt(classes, ids, task = TASK_CLASSIFICATION) {
  return makeAnnotationPrompt(classes, ids, task);
}
export function parseAnnotations(text, frames, classes, task = TASK_CLASSIFICATION) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = clean.indexOf('['), last = clean.lastIndexOf(']');
  if (first < 0 || last < first) throw new Error('Gemma n’a pas renvoyé un tableau JSON exploitable. Réessaie ce lot.');
  const rows = JSON.parse(clean.slice(first, last + 1));
  if (!Array.isArray(rows) || rows.length !== frames.length || new Set(rows.map(r => r?.id)).size !== frames.length || frames.some(f => !rows.some(r => r?.id === f.id))) throw new Error('Réponse Gemma incomplète ou identifiants incohérents. Aucune annotation du lot n’a été appliquée.');
  return frames.map(f => {
    const r = rows.find(row => row.id === f.id);
    if (task === TASK_DETECTION) {
      if (!Array.isArray(r.objects) || r.objects.length > 20 || r.objects.some(o => !o || !validBox(o.box_2d))) throw new Error('Rectangles de détection invalides.');
      return { id:f.id, objects:r.objects.map((o,index) => ({id:'obj_'+index,label:classes.includes(o.label)?o.label:'indéterminé',box_2d:[...o.box_2d],reason:typeof o.reason==='string'?o.reason.slice(0,180):'À vérifier.',uncertain:!classes.includes(o.label)||o.uncertain!==false})),incomplete:r.incomplete!==false,reason:typeof r.reason==='string'?r.reason.slice(0,350):'Vérifiez tous les objets et ajoutez les éventuels manquants.' };
    }
    const valid = classes.includes(r.label);
    return { id: f.id, label: valid ? r.label : 'indéterminé', uncertain: !valid || r.uncertain !== false, reason: typeof r.reason === 'string' ? r.reason.slice(0, 350) : 'Vérification humaine nécessaire.' };
  });
}
async function hash(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), x => x.toString(16).padStart(2, '0')).join(''); }
export async function annotate(body, env, fetcher = fetch, runtime = {}) {
  validateInput(body);
  const key = env.GEMINI_API_KEY;
  if (!key) return json({ error: 'La clé Google AI Studio doit être configurée côté serveur dans GEMINI_API_KEY.', code: 'MISSING_KEY' }, 503);
  const model = env.GEMMA_MODEL || MODEL;
  if (model !== MODEL) return json({ error: 'Ce projet est configuré exclusivement pour Gemma 4 26B A4B IT.', code: 'INVALID_MODEL' }, 503);
  const prompt = makePrompt(body.classes, body.frames.map(f => f.id), body.task);
  const parts = [{ text: prompt }];
  for (const f of body.frames) parts.push({ text: 'IMAGE_ID=' + f.id }, { inlineData: { mimeType: 'image/jpeg', data: f.data.split(',')[1] } });
  const start = Date.now();
  const requestId = crypto.randomUUID();
  const sleep = runtime.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = runtime.now || Date.now;
  const deadline = now() + 55000;
  const payload = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: .1, maxOutputTokens: body.task===TASK_DETECTION?4096:2048, thinkingConfig: { thinkingLevel: 'minimal' } } });
  let response, attempts = 0;
  for (let attempt = 0; attempt < 3 && now() < deadline; attempt++) {
    attempts++;
    // Clear any previous HTTP response so a subsequent network failure cannot
    // accidentally be reported using an earlier status or parsed as success.
    response = undefined;
    try {
      response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: payload,
        signal: AbortSignal.timeout(Math.max(1, Math.min(body.task===TASK_DETECTION?30000:17000, deadline - now())))
      });
    } catch { /* Network interruptions are retried within the same bounded budget. */ }
    if (response?.ok) break;
    if (response && ![408, 429, 500, 502, 503, 504].includes(response.status)) break;
    if (attempt === 2) break;
    const retryAfter = Number(response?.headers.get('retry-after'));
    // A long quota cooldown is not a transient retry within this request.
    if (Number.isFinite(retryAfter) && retryAfter > 5) break;
    const delay = Math.max(attempt === 0 ? 600 : 1400, Number.isFinite(retryAfter) ? Math.max(0, retryAfter * 1000) : 0);
    if (now() + delay >= deadline) break;
    try { await response?.body?.cancel(); } catch { /* Nothing sensitive is logged. */ }
    await sleep(delay);
  }
  const diagnostic = { request_id: requestId, attempts, elapsed_ms: Date.now() - start };
  if (!response) {
    console.warn(JSON.stringify({ event: 'gemma_unreachable', request_id: requestId, attempts }));
    return json({ error: 'Google reste injoignable après ' + attempts + ' tentative(s). Tes images sont conservées : clique à nouveau sur « Annoter avec Gemma » sans recharger la page.', code: 'UPSTREAM_UNAVAILABLE', retryable: true, ...diagnostic }, 504);
  }
  if (!response.ok) {
    // Never forward upstream text: it can contain credential or request details.
    const errors = { 400: 'Google refuse la requête. Vérifie que la clé et le modèle sont disponibles pour ce projet Google.', 401: 'Clé Google invalide ou expirée.', 403: 'Accès refusé : vérifie la clé, ses restrictions et l’accès au modèle.', 404: 'Le modèle Gemma demandé n’est pas accessible avec ce projet Google.', 429: 'Quota Google atteint. Attends avant de relancer l’annotation.', 500: 'Google rencontre une erreur interne sur Gemma.', 502: 'La passerelle Google est temporairement indisponible.', 503: 'Gemma est momentanément surchargé chez Google.', 504: 'Google n’a pas répondu dans le délai prévu.', 408: 'Google a interrompu la requête avant de répondre.' };
    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
    console.warn(JSON.stringify({ event: 'gemma_http_error', google_status: response.status, request_id: requestId, attempts }));
    return json({ error: (errors[response.status] || 'Google a refusé l’annotation.') + ' (Google ' + response.status + ', ' + attempts + ' tentative(s).) Tes images sont conservées.', code: 'GOOGLE_' + response.status, upstream_status: response.status, retryable, ...diagnostic }, response.status === 429 ? 429 : 502);
  }
  try {
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '';
    const annotations = parseAnnotations(text, body.frames, body.classes, body.task);
    return json({ annotations, provenance: { model: MODEL, task:body.task||TASK_CLASSIFICATION, prompt_version: promptVersion(body.task), prompt_sha256: await hash(prompt), annotated_at: new Date().toISOString(), request_id: requestId, elapsed_ms: Date.now() - start, upstream_requests: attempts, recovered_after_retry: attempts > 1, usage: data.usageMetadata || null } });
  } catch { return json({ error: 'Réponse Gemma non exploitable. Aucune proposition artificielle n’a été ajoutée ; réessaie le lot.', code: 'INVALID_MODEL_OUTPUT' }, 502); }
}
export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return new Response(PAGE, { headers: { ...security, 'Content-Type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ app: 'LushiData', version: VERSION, model: MODEL, configured: !!env.GEMINI_API_KEY, storage: 'browser-memory', api_tested: false });
    if (url.pathname === '/api/annotate' && request.method === 'POST') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: 'Origine refusée.' }, 403);
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'JSON requis.' }, 415);
      if (Number(request.headers.get('content-length')) > 3_000_000) return json({ error: 'Lot trop volumineux.' }, 413);
      const identity = request.headers.get('oai-authenticated-user-id') || request.headers.get('cf-connecting-ip') || 'local';
      const now = Date.now(), old = rate.get(identity);
      if (old && now - old < 1200) return json({ error: 'Patiente un instant entre deux lots.' }, 429);
      if (rate.size > 500) rate.clear();
      rate.set(identity, now);
      let body;
      try { const text = await request.text(); if (text.length > 3_000_000) return json({ error: 'Lot trop volumineux.' }, 413); body = JSON.parse(text); validateInput(body); }
      catch (e) { return json({ error: e.message || 'Requête invalide.' }, 400); }
      return annotate(body, env);
    }
    return json({ error: 'Route introuvable.' }, 404);
  }
};
