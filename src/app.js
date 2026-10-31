import { VERSION, MODEL, DEFAULT_CLASSES, UNKNOWN, PROMPT_VERSION, LIMIT, enc, sha256, safeSlug, imageMetrics, classifyQuality, datasetReport, annotationRecord, csvCell, makeZip, makeAnnotationPrompt } from './core.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fresh = () => ({ name: 'Lushi · Tri des déchets', classes: [...DEFAULT_CLASSES], interval: 3, threshold: 35, frames: [], sources: [], requests: 0, gemmaMs: 0, reviewMs: 0, license: '' });
let state = fresh(), busy = false, currentView = 'collect', filter = 'all', activeFrame = null, reviewOpened = 0, cameraStream = null, cameraCapturing = false, toastTimer;
function toast(text, error = false) { $('toast').textContent = text; $('toast').className = 'toast' + (error ? ' error' : ''); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, error ? 9000 : 5000); }
function setBusy(value) {
  busy = value;
  for (const id of ['importBtn', 'cameraBtn', 'demoBtn', 'annotateBtn', 'resetBtn', 'exportBtn']) $(id).disabled = value;
  $('videoInput').disabled = value;
  renderMetrics();
}
function showView(view) {
  currentView = view;
  for (const name of ['collect', 'review', 'export']) $(name + 'View').hidden = name !== view;
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
  const titles = { collect: ['De la vidéo aux<br>données <span>utiles.</span>', 'Gemma propose. Vous vérifiez.<br>Votre prochain modèle commence ici.'], review: ['Des propositions.<br>Votre <span>validation.</span>', 'Une catégorie n’est jamais une certitude.<br>Votre regard transforme une proposition en annotation.'], export: ['Des données.<br>Et leurs <span>preuves.</span>', 'Chaque image a une source, chaque décision une trace.<br>Exportez un dataset dont vous connaissez les limites.'] };
  $('pageTitle').innerHTML = titles[view][0] + '<svg viewBox="0 0 72 24" aria-hidden="true"><path d="M3 16Q34 1 68 9M8 22Q38 10 62 15"/></svg>';
  $('pageSubtitle').innerHTML = titles[view][1];
  $('breadcrumb').textContent = state.frames.length ? state.name : 'Nouveau dataset';
  if (view === 'review') renderFrames();
  if (view === 'export') renderPassport();
}
function renderMetrics() {
  const approved = state.frames.filter(f => f.status === 'approved').length;
  const filtered = state.frames.filter(f => f.status === 'filtered').length;
  const pending = state.frames.filter(f => f.status === 'pending').length;
  $('statFrames').textContent = state.frames.length;
  $('statSources').textContent = state.sources.length ? state.sources.length + ' source' + (state.sources.length > 1 ? 's' : '') + ' dans votre espace' : 'Aucune source importée';
  $('statFiltered').textContent = filtered;
  $('statApproved').innerHTML = approved + '<span class="metric-unit"> image' + (approved > 1 ? 's' : '') + '</span>';
  $('statReview').textContent = pending ? pending + ' image' + (pending > 1 ? 's' : '') + ' à vérifier' : 'Chaque validation est une décision';
  $('statReady').textContent = approved ? approved + ' image' + (approved > 1 ? 's' : '') + ' validée' + (approved > 1 ? 's' : '') + ' dans le ZIP' : 'Validez votre première image';
  $('navPending').textContent = pending;
  $('annotateCount').textContent = state.frames.filter(f => f.status === 'pending' && !f.prediction).length || '';
  $('exportBtn').disabled = busy || !approved;
  for (const s of ['all', 'pending', 'approved', 'filtered', 'rejected']) $('count' + s[0].toUpperCase() + s.slice(1)).textContent = s === 'all' ? state.frames.length : state.frames.filter(f => f.status === s).length;
  const locked = !!state.frames.length || busy;
  for (const id of ['classesInput', 'intervalInput', 'thresholdInput']) $(id).disabled = locked;
  $('classChips').innerHTML = state.classes.map(c => '<span class="chip">' + esc(c) + '</span>').join('');
}
function renderSources() {
  $('sourceList').innerHTML = state.sources.map(s => '<div class="source-row"><span class="source-icon">' + (s.synthetic ? '✧' : s.type === 'webcam' ? '◎' : '▷') + '</span><div><strong>' + esc(s.name) + '</strong><small>' + (s.synthetic ? 'Illustration synthétique' : s.type === 'webcam' ? 'Capture webcam' : 'SHA-256 ' + esc(s.sha256.slice(0, 12)) + '…') + ' · ' + fmt(s.duration) + ' s</small></div><span>' + state.frames.filter(f => f.sourceId === s.id).length + ' images</span></div>').join('');
}
const statusName = { pending: 'À vérifier', approved: 'Validée', filtered: 'Filtrée', rejected: 'Rejetée' };
function renderFrames() {
  renderMetrics();
  const frames = state.frames.filter(f => filter === 'all' || f.status === filter);
  if (!frames.length) { $('frameGrid').innerHTML = '<div class="empty-state"><span>✧</span><h3>' + (state.frames.length ? 'Rien dans ce filtre, pour le moment.' : 'Votre première image vous attend.') + '</h3><p>' + (state.frames.length ? 'Choisissez un autre filtre pour retrouver vos images.' : 'Importez une vidéo ou essayez l’exemple synthétique pour explorer le parcours.') + '</p><button class="btn btn-soft" id="backToCollect">Retour à la collecte →</button></div>'; $('backToCollect').onclick = () => showView('collect'); return; }
  $('frameGrid').innerHTML = frames.map(f => '<article class="frame-card ' + f.status + '" data-frame="' + esc(f.id) + '" tabindex="0" role="button" aria-label="Vérifier ' + esc(f.id) + '"><img loading="lazy" src="' + f.data + '" alt="Image extraite à ' + fmt(f.time) + ' secondes"><div class="frame-card-body"><div><span class="frame-label">' + esc(f.label || 'Sans proposition') + '</span><span class="status-tag ' + f.status + '">' + (f.status === 'filtered' ? esc(f.filterReason) : statusName[f.status]) + '</span></div><p class="frame-reason">' + esc(f.prediction?.reason || (f.status === 'filtered' ? 'Filtre indicatif : vous pouvez récupérer cette image.' : 'Lancez Gemma ou attribuez une catégorie vous-même.')) + '</p><div class="frame-meta"><span>' + esc(f.sourceId.slice(0, 8)) + ' · ' + fmt(f.time) + ' s</span><span>Netteté ' + fmt(f.sharpness) + '</span></div></div><div class="card-action"><span>' + (f.status === 'approved' ? 'Revoir la décision' : 'Ouvrir & vérifier') + '</span><span>↗</span></div></article>').join('');
  for (const card of $('frameGrid').querySelectorAll('[data-frame]')) { card.onclick = () => openFrame(card.dataset.frame); card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFrame(card.dataset.frame); } }; }
}
function openFrame(id) {
  if (busy) return toast('Attends la fin du traitement avant de modifier les images.');
  const f = state.frames.find(f => f.id === id); if (!f) return;
  activeFrame = id; reviewOpened = performance.now();
  const source = state.sources.find(s => s.id === f.sourceId);
  $('frameDetail').innerHTML = '<div class="detail-layout"><div><img class="detail-image" src="' + f.data + '" alt="Image à vérifier"><div class="evidence-row"><span>Source</span><span>' + esc(source?.name) + '</span></div><div class="evidence-row"><span>Position</span><span>' + fmt(f.time) + ' s</span></div><div class="evidence-row"><span>Netteté / luminosité</span><span>' + fmt(f.sharpness) + ' / ' + f.brightness + '</span></div><div class="evidence-row"><span>SHA-256 image</span><span title="' + f.sha256 + '">' + f.sha256.slice(0, 20) + '…</span></div></div><div class="detail-info"><span class="eyebrow">REVUE HUMAINE</span><h2>Votre décision compte.</h2><span class="status-tag ' + f.status + '">' + statusName[f.status] + '</span>' + (f.prediction ? '<p><strong>Proposition de Gemma : ' + esc(f.prediction.label) + '</strong><br>' + esc(f.prediction.reason) + '</p>' + (f.prediction.uncertain ? '<p class="detail-help">Gemma signale une ambiguïté. Inspectez l’image avant de décider.</p>' : '') : '<p>Aucune proposition de modèle pour cette image. Une annotation manuelle reste possible.</p>') + (f.filterReason ? '<p class="detail-help">Filtre initial : ' + esc(f.filterReason) + '. Récupérer cette image sera consigné dans le rapport.</p>' : '') + '<label for="labelSelect">Catégorie finale</label><select id="labelSelect"><option value="">Choisir une catégorie…</option>' + state.classes.map(c => '<option value="' + esc(c) + '"' + (f.label === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select><div class="detail-actions">' + (f.status === 'filtered' ? '<button class="btn btn-primary" id="restoreFrame">Récupérer pour revue</button>' : '<button class="btn btn-primary" id="approveFrame">✓ Valider l’image</button>') + '<button class="btn btn-white" id="rejectFrame">Rejeter</button></div><p class="keyboard-hint">Valider enregistre la catégorie et la date de votre décision.</p></div></div>';
  if (!$('frameDialog').open) $('frameDialog').showModal();
  if ($('approveFrame')) $('approveFrame').onclick = () => {
    const label = $('labelSelect').value; if (!state.classes.includes(label)) return toast('Choisis une catégorie valide avant de confirmer.', true);
    f.label = label; f.status = 'approved'; f.reviewedAt = new Date().toISOString(); finishReview(); toast('Image validée et ajoutée au futur export.');
  };
  if ($('restoreFrame')) $('restoreFrame').onclick = () => { f.status = 'pending'; f.qualityOverride = true; finishReview(); toast('Image récupérée. Elle reste à annoter et à valider.'); };
  $('rejectFrame').onclick = () => { f.status = 'rejected'; f.reviewedAt = new Date().toISOString(); finishReview(); toast('Image rejetée. La décision sera documentée.'); };
}
function finishReview() { state.reviewMs += Math.round(performance.now() - reviewOpened); $('frameDialog').close(); activeFrame = null; renderFrames(); }
function syncSettings() {
  const classes = $('classesInput').value.split(',').map(s => s.trim()).filter(Boolean);
  const slugs = classes.map(safeSlug);
  if (classes.length < 2 || classes.length > 8 || classes.some(c => c.length > 40 || c === UNKNOWN || /[\r\n<>]/.test(c)) || new Set(classes).size !== classes.length || new Set(slugs).size !== slugs.length) throw new Error('Choisis 2 à 8 catégories distinctes, sans doublons après normalisation.');
  state.classes = classes; state.interval = +$('intervalInput').value; state.threshold = +$('thresholdInput').value;
  state.name = $('datasetName').value.trim() || 'Mon dataset';
}
async function captureImage(drawable, source, time) {
  const nativeWidth = drawable.videoWidth || drawable.width, nativeHeight = drawable.videoHeight || drawable.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(nativeWidth, 640); canvas.height = Math.round(nativeHeight * canvas.width / nativeWidth);
  const ctx = canvas.getContext('2d'); ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  const tiny = document.createElement('canvas'); tiny.width = 160; tiny.height = 90;
  const tc = tiny.getContext('2d', { willReadFrequently: true }); tc.drawImage(canvas, 0, 0, 160, 90);
  const metrics = imageMetrics(tc.getImageData(0, 0, 160, 90).data, 160, 90);
  const data = canvas.toDataURL('image/jpeg', .83);
  const bytes = Uint8Array.from(atob(data.split(',')[1]), c => c.charCodeAt(0));
  const filterReason = classifyQuality(metrics, state.frames.filter(f => !f.filterReason || f.qualityOverride), state.threshold);
  state.frames.push({ id: 'img_' + crypto.randomUUID().slice(0, 8), sourceId: source.id, time: Math.round(time * 100) / 100, data, sha256: await sha256(bytes), ...metrics, filterReason, status: filterReason ? 'filtered' : 'pending', label: '', prediction: null, reviewedAt: null });
}
function waitEvent(element, event, action, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); element.removeEventListener(event, done); element.removeEventListener('error', fail); };
    const done = () => { clean(); resolve(); }; const fail = () => { clean(); reject(new Error('Cette vidéo ne peut pas être décodée. Essaie un MP4 H.264 ou un WebM.')); };
    const timer = setTimeout(() => { clean(); reject(new Error('La lecture de la vidéo a dépassé le délai. Essaie un extrait plus court.')); }, timeout);
    element.addEventListener(event, done, { once: true }); element.addEventListener('error', fail, { once: true });
    try { action(); } catch (e) { clean(); reject(e); }
  });
}
async function importFiles(files) {
  if (busy) return;
  try { syncSettings(); } catch (e) { return toast(e.message, true); }
  if (state.frames.length >= LIMIT) return toast('Limite de 48 images atteinte. Exporte ou démarre un nouveau dataset.', true);
  if (!files.length) return;
  setBusy(true); $('progressArea').hidden = false;
  try {
    for (const file of files) {
      if (state.frames.length >= LIMIT) break;
      if (state.sources.length >= 6) { toast('Six sources maximum pour ce prototype.', true); break; }
      if (file.size > 50 * 1024 * 1024) { toast(file.name + ' dépasse 50 Mo.', true); continue; }
      if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) { toast('Le fichier doit être une vidéo.', true); continue; }
      $('progressText').textContent = 'Lecture de ' + file.name;
      const digest = await sha256(await file.arrayBuffer());
      if (state.sources.some(s => s.sha256 === digest)) { toast('Cette vidéo est déjà présente : doublon de source évité.'); continue; }
      const video = document.createElement('video'), url = URL.createObjectURL(file);
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      try {
        await waitEvent(video, 'loadedmetadata', () => { video.src = url; video.load(); });
        let duration = video.duration;
        if (!Number.isFinite(duration)) { await waitEvent(video, 'seeked', () => video.currentTime = 1e8); duration = video.duration; }
        if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) throw new Error('Durée ou dimensions de vidéo non exploitables.');
        const source = { id: 'src_' + digest.slice(0, 12), sha256: digest, name: file.name, duration: Math.round(duration * 100) / 100, synthetic: false, type: 'video', rights: 'Droits à déclarer par l’utilisateur.' };
        const count = Math.min(16, Math.ceil(duration / state.interval), LIMIT - state.frames.length);
        // Spread samples over the entire source rather than taking only its beginning.
        let added = false;
        for (let i = 0; i < count; i++) {
          const time = Math.min(duration - .03, .05 + i * Math.max(state.interval, duration / count));
          await waitEvent(video, 'seeked', () => video.currentTime = Math.max(.001, time));
          await captureImage(video, source, time);
          if (!added) { state.sources.push(source); added = true; }
          $('progressBar').value = Math.round((i + 1) / count * 100); $('progressText').textContent = 'Extraction · ' + file.name; $('progressCount').textContent = (i + 1) + ' / ' + count;
          renderMetrics(); await pause(0);
        }
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); renderSources(); }
    }
    toast('Collecte terminée. Ouvre la revue pour lancer Gemma.');
  } catch (e) { toast(e.message, true); }
  finally { setBusy(false); $('videoInput').value = ''; $('progressArea').hidden = true; renderSources(); }
}
async function startCamera() {
  if (busy) return;
  try {
    syncSettings();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('La webcam nécessite HTTPS ou localhost et un navigateur compatible.');
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: { ideal: 'environment' } }, audio: false });
    $('cameraPreview').srcObject = cameraStream; $('cameraArea').hidden = false; await $('cameraPreview').play();
    $('recordBtn').textContent = '● Capturer 10 s'; $('recordBtn').disabled = false;
  } catch (e) { stopCamera(); toast(e.name === 'NotAllowedError' ? 'Accès caméra refusé. Tu peux importer une vidéo.' : e.message, true); }
}
function stopCamera() { cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null; $('cameraPreview').srcObject = null; $('cameraArea').hidden = true; }
async function captureCamera() {
  if (busy || !cameraStream) return;
  if (state.frames.length >= LIMIT || state.sources.length >= 6) return toast('Limite de collecte atteinte.', true);
  setBusy(true); cameraCapturing = true; $('recordBtn').disabled = true; $('closeCameraBtn').disabled = true;
  const source = { id: 'cam_' + crypto.randomUUID().slice(0, 12), sha256: null, name: 'Webcam · ' + new Date().toLocaleTimeString('fr-FR'), duration: 10, type: 'webcam', rights: 'Droits à déclarer par l’utilisateur.', synthetic: false };
  try {
    for (let second = 0; second < 10 && state.frames.length < LIMIT; second++) {
      $('cameraTimer').textContent = 'Capture ' + (second + 1) + ' / 10 s';
      if (second % state.interval === 0) { await captureImage($('cameraPreview'), source, second); if (!state.sources.some(s => s.id === source.id)) state.sources.push(source); renderMetrics(); }
      await pause(1000);
    }
    // A webcam source has frame checksums; no original video file is retained.
    source.sha256 = await sha256(state.frames.filter(f => f.sourceId === source.id).map(f => f.sha256).join('\n'));
    source.checksum_kind = 'sha256-of-captured-frame-hashes';
    toast('Capture terminée. La caméra est maintenant arrêtée.');
  } catch (e) { toast(e.message, true); }
  finally { stopCamera(); cameraCapturing = false; $('closeCameraBtn').disabled = false; setBusy(false); renderSources(); }
}
function demoCanvas(kind, index) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
  const c = canvas.getContext('2d');
  const backgrounds = ['#e9f0e8', '#e7e9f0', '#f0e7dc'];
  c.fillStyle = backgrounds[kind]; c.fillRect(0, 0, 640, 400);
  // Texture is deterministic and visibly illustrative, never a claimed field photo.
  for (let i = 0; i < 55; i++) { c.fillStyle = i % 2 ? '#ffffff70' : '#655c4a15'; c.fillRect((i * 83 + index * 31) % 640, (i * 47) % 400, 2 + i % 13, 2); }
  c.fillStyle = '#25302210'; c.beginPath(); c.ellipse(320, 336, 106, 15, 0, 0, Math.PI * 2); c.fill();
  c.save(); c.translate(320, 210); c.rotate((index - 1.5) * .11);
  if (kind === 0) {
    c.fillStyle = '#5eae9955'; c.strokeStyle = '#468c7b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-17, -126); c.lineTo(17, -126); c.lineTo(17, -100); c.bezierCurveTo(17, -80, 47, -70, 49, -39); c.lineTo(50, 110); c.quadraticCurveTo(0, 130, -50, 110); c.lineTo(-49, -39); c.bezierCurveTo(-47, -70, -17, -80, -17, -100); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#386f5d'; c.fillRect(-21, -140, 42, 17); c.fillStyle = '#eaf4dd'; c.fillRect(-47, -5, 94, 60);
    c.strokeStyle = '#52948550'; for (let y = 65; y <= 100; y += 14) { c.beginPath(); c.moveTo(-42, y); c.lineTo(42, y); c.stroke(); }
    c.fillStyle = '#608365'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.fillText('EAU', 0, 30);
    c.strokeStyle = '#ffffffa0'; c.lineWidth = 8; c.beginPath(); c.moveTo(-30, -48); c.lineTo(-30, -15); c.stroke();
  } else if (kind === 1) {
    const g = c.createLinearGradient(-60, 0, 60, 0); g.addColorStop(0, '#8c98a4'); g.addColorStop(.35, '#e4e9ed'); g.addColorStop(1, '#a1abb8'); c.fillStyle = g;
    c.beginPath(); c.roundRect(-61, -105, 122, 225, 12); c.fill(); c.fillStyle = '#c7d0d6'; c.beginPath(); c.ellipse(0, -105, 61, 12, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#7c8c9e'; c.lineWidth = 3; c.stroke();
    c.strokeStyle = '#8795a4'; c.lineWidth = 5; c.beginPath(); c.ellipse(0, -107, 12, 5, 0, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#768fa68a'; c.fillRect(-58, -55, 116, 116); c.fillStyle = '#edf0f4'; c.font = 'bold 19px sans-serif'; c.textAlign = 'center'; c.fillText('CAN', 0, 10); c.strokeStyle = '#6e7f9270'; c.beginPath(); c.ellipse(0, 115, 58, 8, 0, 0, Math.PI); c.stroke();
  } else {
    c.fillStyle = '#cba771'; c.beginPath(); c.moveTo(-108, -55); c.lineTo(4, -98); c.lineTo(107, -42); c.lineTo(-6, 3); c.closePath(); c.fill();
    c.fillStyle = '#b48a56'; c.beginPath(); c.moveTo(-108, -55); c.lineTo(-6, 3); c.lineTo(-6, 126); c.lineTo(-108, 63); c.closePath(); c.fill();
    c.fillStyle = '#a57b49'; c.beginPath(); c.moveTo(-6, 3); c.lineTo(107, -42); c.lineTo(107, 78); c.lineTo(-6, 126); c.closePath(); c.fill();
    c.strokeStyle = '#e4c69c'; c.lineWidth = 19; c.beginPath(); c.moveTo(-51, -77); c.lineTo(52, -20); c.lineTo(52, 101); c.stroke(); c.strokeStyle = '#79552e'; c.lineWidth = 2; c.beginPath(); c.moveTo(-108, -55); c.lineTo(-6, 3); c.lineTo(-6, 126); c.stroke();
  }
  c.restore(); c.fillStyle = '#645d7370'; c.font = '11px sans-serif'; c.fillText('LUSHIDATA · ILLUSTRATION SYNTHÉTIQUE', 22, 377);
  return canvas;
}
async function loadDemo() {
  if (busy) return;
  if (state.frames.length) return toast('Démarre un nouveau dataset pour ouvrir l’exemple synthétique.', true);
  try { syncSettings(); } catch (e) { return toast(e.message, true); }
  setBusy(true); $('progressArea').hidden = false;
  try {
    for (let kind = 0; kind < 3; kind++) {
      const source = { id: 'demo_source_' + kind, name: ['Bouteille illustrée', 'Canette illustrée', 'Carton illustré'][kind], duration: kind === 0 ? 18 : 12, synthetic: true, type: 'synthetic', checksum_kind: 'sha256-of-procedural-recipe-id', rights: 'Illustrations procédurales LushiData, CC0-1.0.', sha256: await sha256('lushidata-demo-v1-' + kind) };
      state.sources.push(source);
      for (let i = 0; i < 4; i++) { await captureImage(demoCanvas(kind, i), source, i * 3); $('progressBar').value = (kind * 4 + i + 1) / 12 * 100; await pause(15); }
    }
    const source = state.sources[0], canvas = demoCanvas(0, 0);
    await captureImage(canvas, source, 12); // Intentional exact visual duplicate for filter demonstration.
    const blank = document.createElement('canvas'); blank.width = 640; blank.height = 400; blank.getContext('2d').fillStyle = '#bab4b0'; blank.getContext('2d').fillRect(0, 0, 640, 400); await captureImage(blank, source, 15);
    state.license = 'CC0-1.0 — illustrations synthétiques LushiData uniquement'; $('licenseInput').value = state.license;
    renderSources(); toast('Exemple synthétique chargé. Les annotations seront réellement proposées par Gemma.'); showView('review');
  } catch (e) { toast(e.message, true); }
  finally { $('progressArea').hidden = true; setBusy(false); }
}
async function runGemma() {
  if (busy) return;
  if (!$('consentInput').checked) return toast('Confirme tes droits et l’envoi des images à Google avant de lancer Gemma.', true);
  const frames = state.frames.filter(f => f.status === 'pending' && !f.prediction);
  if (!frames.length) return toast('Aucune image sans proposition à annoter. Récupère une image filtrée ou importe une nouvelle source.');
  setBusy(true); const progress = $('annotationProgress'); progress.hidden = false; progress.className = 'annotation-progress';
  state.sources.filter(s => !s.synthetic).forEach(s => s.rights = 'L’utilisateur a déclaré disposer des droits et autorisé l’envoi à Google.');
  let done = 0;
  try {
    for (let i = 0; i < frames.length; i += 4) {
      const batch = frames.slice(i, i + 4); progress.textContent = '✦ Gemma observe les images… ' + done + ' / ' + frames.length + ' · lot ' + (Math.floor(i / 4) + 1);
      state.requests++;
      const response = await fetch('/api/annotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classes: state.classes, frames: batch.map(({ id, data }) => ({ id, data })) }), signal: AbortSignal.timeout(70000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Annotation indisponible.');
      state.gemmaMs += result.provenance.elapsed_ms;
      for (const annotation of result.annotations) {
        const f = batch.find(f => f.id === annotation.id); if (!f) throw new Error('Identifiant inattendu dans la réponse.');
        f.prediction = { ...annotation, ...result.provenance }; f.label = annotation.label;
      }
      done += batch.length; renderFrames();
      if (i + 4 < frames.length) await pause(1500);
    }
    progress.textContent = '✓ ' + done + ' propositions reçues de Gemma. À vous de vérifier chaque image.'; toast('Gemma a terminé. Aucune image n’a été validée automatiquement.');
    $('apiStatus').innerHTML = '<span class="dot"></span> Gemma · appel réussi'; $('apiStatus').className = 'api-badge';
  } catch (e) {
    progress.textContent = (e.name === 'TimeoutError' ? 'Le délai d’annotation a été dépassé.' : e.message) + ' ' + done + ' image(s) déjà annotée(s) conservée(s). Tu peux réessayer.'; progress.className = 'annotation-progress error'; toast(e.message || 'Impossible de contacter Gemma.', true);
    $('apiStatus').innerHTML = '<span class="dot"></span> Gemma · appel à vérifier'; $('apiStatus').className = 'api-badge warning';
  } finally { setBusy(false); renderFrames(); }
}
function renderPassport() {
  const report = datasetReport(state), counts = report.counts, max = Math.max(1, ...Object.values(counts.by_class));
  $('passportContent').innerHTML = '<div class="passport-body"><div class="report-numbers"><div class="report-number"><strong>' + counts.approved + '</strong><small>images validées</small></div><div class="report-number"><strong>' + state.sources.length + '</strong><small>sources documentées</small></div><div class="report-number"><strong>' + report.split.independentGroups + '</strong><small>groupes indépendants</small></div></div><h3 class="report-section-title">DISTRIBUTION DES CATÉGORIES</h3>' + state.classes.map(c => '<div class="class-bar"><span title="' + esc(c) + '">' + esc(c) + '</span><div><i style="width:' + counts.by_class[c] / max * 100 + '%"></i></div><span>' + counts.by_class[c] + '</span></div>').join('') + '<h3 class="report-section-title">SÉPARATION PAR SOURCE, PAS PAR IMAGE</h3><div class="split-legend">' + ['train', 'val', 'test'].map(s => '<div>' + s.toUpperCase() + '<strong>' + counts.by_split[s] + '</strong> images</div>').join('') + '</div><p style="font-size:9px;margin-top:10px">Une vidéo reste dans une seule partition. Les sources présentant des images visuellement similaires sont regroupées.</p><h3 class="report-section-title">LES TRACES DE VOTRE TRAVAIL</h3><div class="evidence-row"><span>Modèle hébergé</span><span>' + MODEL + '</span></div><div class="evidence-row"><span>Requêtes Gemma / temps API</span><span>' + state.requests + ' / ' + fmt(state.gemmaMs / 1000) + ' s</span></div><div class="evidence-row"><span>Propositions revues / inchangées</span><span>' + report.review.model_proposals_reviewed + ' / ' + report.review.approved_without_label_change + '</span></div><div class="evidence-row"><span>Temps de revue enregistré</span><span>' + fmt(state.reviewMs / 1000) + ' s</span></div><div class="evidence-row"><span>Traçabilité</span><span>SHA-256 · source · horodatage · décision</span></div><div class="warning-box"><strong>◈ Limites à conserver avec les données</strong><ul>' + report.limitations.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div></div>';
  $('exportBtn').disabled = busy || !counts.approved;
}
function download(blob, filename) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function datasetCard(report) {
  return '# ' + state.name + '\n\nDataset de classification d’images à étiquette unique, préparé avec LushiData ' + VERSION + '.\n\n' +
  '## Usage\n\nPrototype de classification. Les catégories ne sont pas des boîtes de détection. Le dataset est petit et ne démontre aucune performance d’un futur modèle.\n\n' +
  '## Contenu\n\n' + report.counts.approved + ' images JPEG validées humainement. Catégories : ' + state.classes.join(', ') + '.\n\n' +
  '## Annotation\n\nGemma hébergé : ' + MODEL + '. Prompt : ' + PROMPT_VERSION + '. Chaque ligne indique si l’annotation est assistée par Gemma ou manuelle. Seules les images explicitement validées sont exportées. Le taux d’acceptation n’est pas une précision scientifique.\n\n' +
  '## Partitions\n\nSources entières regroupées par similarité perceptuelle, puis séparées de manière déterministe. Ratio non garanti ; ' + report.split.independentGroups + ' groupes indépendants. ' + JSON.stringify(report.counts.by_split) + '. Ne pas répartir aléatoirement les images adjacentes.\n\n' +
  '## Limites\n\n' + report.limitations.map(w => '- ' + w).join('\n') + '\n- La détection de doublons est heuristique, pas une garantie d’indépendance sémantique.\n- Aucune mesure de généralisation, de précision ni de représentativité de Lubumbashi n’est revendiquée.\n\n' +
  '## Droits\n\n' + report.license + '\n\n## Provenance et contrôles\n\nConsulter annotations.jsonl, sources.json, quality_report.json et checksums.sha256. Les images exclues ne sont pas incluses dans le ZIP ; leurs métadonnées restent dans rejected_manifest.json.\n\n' +
  '## Chargement\n\nStructure ImageFolder : train/<catégorie>/*.jpg, val/<catégorie>/*.jpg, test/<catégorie>/*.jpg. Les partitions vides et classes absentes restent une limite à résoudre avant une évaluation.\n';
}
async function exportDataset() {
  if (busy) return;
  const approved = state.frames.filter(f => f.status === 'approved' && state.classes.includes(f.label));
  if (!approved.length) return toast('Valide au moins une image avant l’export.', true);
  setBusy(true);
  try {
    state.license = $('licenseInput').value.trim();
    const report = datasetReport(state), files = [], records = [];
    for (const f of approved) {
      const record = annotationRecord(f, report.split.bySource[f.sourceId], state.classes); records.push(record);
      files.push({ name: record.file, data: Uint8Array.from(atob(f.data.split(',')[1]), c => c.charCodeAt(0)) });
    }
    files.push({ name: 'annotations.jsonl', data: records.map(r => JSON.stringify(r)).join('\n') + '\n' });
    const columns = ['id', 'file', 'label', 'class_id', 'split', 'source_id', 'source_timestamp_seconds', 'sha256', 'annotation_origin'];
    files.push({ name: 'annotations.csv', data: columns.join(',') + '\n' + records.map(r => columns.map(c => csvCell(r[c])).join(',')).join('\n') + '\n' });
    files.push({ name: 'classes.json', data: JSON.stringify(state.classes.map((label, id) => ({ id, label, folder: safeSlug(label) })), null, 2) });
    files.push({ name: 'quality_report.json', data: JSON.stringify(report, null, 2) });
    files.push({ name: 'sources.json', data: JSON.stringify(report.sources, null, 2) });
    files.push({ name: 'dataset_card.md', data: datasetCard(report) });
    files.push({ name: 'annotation_prompt.txt', data: 'Template — ' + PROMPT_VERSION + '\n\n' + makeAnnotationPrompt(state.classes, ['<image ids in request order>']) });
    const requestIds = [...new Set(state.frames.filter(f => f.prediction).map(f => f.prediction.request_id))];
    files.push({ name: 'annotation_prompts.json', data: JSON.stringify(requestIds.map(id => { const batch = state.frames.filter(f => f.prediction?.request_id === id); return { request_id: id, prompt_sha256: batch[0].prediction.prompt_sha256, prompt: makeAnnotationPrompt(state.classes, batch.map(f => f.id)) }; }), null, 2) });
    files.push({ name: 'rejected_manifest.json', data: JSON.stringify(state.frames.filter(f => f.status !== 'approved').map(({ data, ...metadata }) => metadata), null, 2) });
    const sums = []; for (const file of files) sums.push(await sha256(typeof file.data === 'string' ? enc.encode(file.data) : file.data) + '  ' + file.name);
    files.push({ name: 'checksums.sha256', data: sums.join('\n') + '\n' });
    download(makeZip(files), safeSlug(state.name) + '.zip'); toast('Dataset exporté : ' + approved.length + ' image(s) validée(s) avec leur passeport.');
  } catch (e) { toast('Export impossible : ' + e.message, true); }
  finally { setBusy(false); renderPassport(); }
}
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => showView(button.dataset.view);
for (const button of document.querySelectorAll('[data-filter]')) button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button)); renderFrames(); };
$('importBtn').onclick = () => $('videoInput').click(); $('videoInput').onchange = e => importFiles([...e.target.files]);
$('dropZone').ondragover = e => { e.preventDefault(); $('dropZone').classList.add('drag-over'); };
$('dropZone').ondragleave = () => $('dropZone').classList.remove('drag-over');
$('dropZone').ondrop = e => { e.preventDefault(); $('dropZone').classList.remove('drag-over'); importFiles([...e.dataTransfer.files]); };
$('cameraBtn').onclick = startCamera; $('recordBtn').onclick = captureCamera; $('closeCameraBtn').onclick = () => { if (!cameraCapturing) stopCamera(); };
$('demoBtn').onclick = loadDemo; $('annotateBtn').onclick = runGemma; $('exportBtn').onclick = exportDataset;
$('datasetName').oninput = () => { state.name = $('datasetName').value.trim() || 'Mon dataset'; $('breadcrumb').textContent = state.name; };
$('classesInput').oninput = () => { try { syncSettings(); renderMetrics(); } catch { $('classChips').textContent = 'Définissez 2 à 8 catégories distinctes.'; } };
$('intervalInput').oninput = e => { state.interval = +e.target.value; $('intervalOutput').textContent = '1 image / ' + state.interval + ' s'; };
$('thresholdInput').oninput = e => { state.threshold = +e.target.value; $('thresholdOutput').textContent = state.threshold; };
$('licenseInput').oninput = e => state.license = e.target.value;
$('reportBtn').onclick = () => download(new Blob([JSON.stringify(datasetReport(state), null, 2)], { type: 'application/json' }), safeSlug(state.name) + '-qualite.json');
$('helpBtn').onclick = () => $('helpDialog').showModal(); $('closeHelpBtn').onclick = $('startHelpBtn').onclick = () => $('helpDialog').close(); $('closeFrameBtn').onclick = () => { $('frameDialog').close(); activeFrame = null; };
$('resetBtn').onclick = () => { if (busy) return; if (state.frames.length && !confirm('Créer un nouveau dataset ? Le travail non exporté sera perdu.')) return; stopCamera(); state = fresh(); filter = 'all'; $('datasetName').value = state.name; $('classesInput').value = state.classes.join(', '); $('intervalInput').value = state.interval; $('thresholdInput').value = state.threshold; $('intervalOutput').textContent = '1 image / 3 s'; $('thresholdOutput').textContent = '35'; $('licenseInput').value = ''; $('consentInput').checked = false; $('annotationProgress').hidden = true; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all')); renderMetrics(); renderSources(); showView('collect'); toast('Nouvel espace prêt.'); };
window.addEventListener('beforeunload', e => { stopCamera(); if (state.frames.length) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && cameraStream && !cameraCapturing) stopCamera(); });
renderMetrics();
fetch('/api/health').then(r => r.json()).then(data => { $('apiStatus').className = 'api-badge' + (data.configured ? '' : ' warning'); $('apiStatus').innerHTML = '<span class="dot"></span> ' + (data.configured ? 'Gemma · clé configurée' : 'Gemma · clé à configurer'); }).catch(() => { $('apiStatus').className = 'api-badge warning'; $('apiStatus').innerHTML = '<span class="dot"></span> Serveur à vérifier'; });
