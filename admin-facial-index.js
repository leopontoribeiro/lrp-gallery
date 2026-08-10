// ── ÍNDICE FACIAL (Arquitetura A — roda no navegador do admin) ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast, signUrls, currentSettingsGalleryId) —
// só usados dentro das funções, chamadas após o app carregar, então a
// ordem de carregamento deste arquivo não importa.
// Limiares de detecção (compartilhados com o agrupamento de Pessoas).
const FACE_MIN_SCORE = 0.6;    // confiança mínima pra considerar que é rosto
const FACE_MIN_W = 0.045;      // largura mínima do rosto, em fração da foto

let _faceApiAdminReady = false;
function _loadScriptAdmin(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function loadFaceApiAdmin() {
  if (_faceApiAdminReady) return;
  await _loadScriptAdmin('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js');
  const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  await faceapi.nets.tinyFaceDetector.loadFromUri(M);
  await faceapi.nets.faceLandmark68Net.loadFromUri(M);
  await faceapi.nets.faceRecognitionNet.loadFromUri(M);
  _faceApiAdminReady = true;
}
async function loadFaceIndexInfo(galleryId) {
  const info = document.getElementById('face-index-info');
  if (!info) return;
  info.textContent = '';
  const { data } = await sb.from('face_indexes').select('face_count,photo_count,updated_at').eq('gallery_id', galleryId).maybeSingle();
  if (!data) { info.textContent = 'Nenhum índice gerado ainda.'; return; }
  const { count } = await sb.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId);
  const stale = (count || 0) - (data.photo_count || 0);
  info.innerHTML = `Índice: ${data.face_count} rosto(s) em ${data.photo_count} foto(s) · ${new Date(data.updated_at).toLocaleDateString('pt-BR')}`
    + (stale > 0 ? ` · <b style="color:var(--accent)">${stale} nova(s) sem índice — atualize</b>` : '');
}
// Nome próprio (não "_loadImageEl"): admin-galleries.js define uma função
// global com aquele nome que recebe File e devolve {im,url,w,h}. Como ela
// carrega DEPOIS deste arquivo, sobrescrevia esta e a indexação chamava a
// versão errada — createObjectURL(string) estourava em toda foto e o índice
// saía sempre com 0 rostos.
function _loadImgForFaceIndex(url) {
  return new Promise((res, rej) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => res(img); img.onerror = () => rej(new Error('falha ao carregar imagem (403/CORS?)')); img.src = url; });
}

// ── Núcleo compartilhado (usado pelo botão manual e pela indexação automática) ──
async function _loadExistingIndex(galleryId) {
  // Só reaproveita o índice anterior se ele JÁ estiver quantizado (qv=1).
  // Índice antigo (float) é reconstruído do zero, agora quantizado (int8).
  const { data: existing } = await sb.from('face_indexes').select('data').eq('gallery_id', galleryId).maybeSingle();
  const ok = existing && existing.data && existing.data.qv === 1;
  return { prevFaces: ok ? (existing.data.faces || []) : [], alreadyDone: new Set(ok ? (existing.data.photos || []) : []) };
}
async function _fetchGalleryPhotosForIndex(galleryId) {
  let photos = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from('photos').select('id,thumb_url,full_url')
      .eq('gallery_id', galleryId).order('position').range(from, from + 499);
    if (error) throw error;
    photos.push(...data);
    if (data.length < 500) break; from += 500;
  }
  return photos;
}
// Roda o face-api sobre as fotos ainda não indexadas. onProgress é opcional
// (a indexação automática pós-upload roda silenciosa, sem barra).
async function _detectFaces(todo, onProgress) {
  const raw = todo.map(p => p.thumb_url || p.full_url);
  const signed = await signUrls(raw);
  // Se a assinatura falhar, signUrls devolve a URL crua sem querystring —
  // o worker rejeita (403) e antes isso virava "0 rostos" sem nenhum aviso.
  const unsignedCount = signed.filter((s, i) => s === raw[i]).length;
  if (unsignedCount) console.error(`face-index: ${unsignedCount}/${raw.length} URL(s) NÃO foram assinadas (sign_urls falhou) — essas fotos vão dar 403 e não geram rosto nenhum.`);

  // 0.4 aceitava coisa que não é rosto (bolo, estampa, luminária). 0.6 corta
  // quase tudo isso. Também ignoramos rosto miúdo demais: abaixo de ~4.5% da
  // largura da foto o vetor sai impreciso e joga a pessoa no grupo errado.
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: FACE_MIN_SCORE });
  const newFaces = []; const processed = []; let done = 0;
  const r3 = x => Math.round(x * 1000) / 1000;
  // Quantização do descritor: float -> int8 [-127..127]. ~3x menos dados.
  const q1 = x => Math.max(-127, Math.min(127, Math.round(x * 127)));
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    try {
      const img = await _loadImgForFaceIndex(signed[i]);
      const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
      const dets = await faceapi.detectAllFaces(img, opts).withFaceLandmarks().withFaceDescriptors();
      for (const d of dets) {
        const bx = d.detection.box;   // caixa do rosto (px) -> normaliza 0..1 p/ recorte no cliente
        if (bx.width / W < FACE_MIN_W) continue;          // rosto pequeno demais = vetor ruim
        newFaces.push({
          p: todo[i].id,
          d: Array.from(d.descriptor).map(q1),
          b: [r3(bx.x / W), r3(bx.y / H), r3(bx.width / W), r3(bx.height / H)],
          s: r3(d.detection.score)                        // confiança: filtro extra no agrupamento
        });
      }
      processed.push(todo[i].id); // só marca como "feito" quando realmente processou
    } catch (e) {
      failed++;
      // Loga a URL assinada (não a crua) pra dar pra reproduzir o erro no console.
      console.error('face-index: falha na foto', todo[i].id, signed[i], e.message || e);
      // NÃO entra em processed — assim uma próxima tentativa reprocessa essa foto
      // em vez de marcá-la como "já vista" pra sempre com 0 rostos.
    }
    done++;
    if (onProgress) onProgress(done, todo.length, newFaces.length);
  }
  if (failed) console.warn(`face-index: ${failed}/${todo.length} foto(s) falharam ao carregar/processar`);
  return { newFaces, processed, failed, unsignedCount };
}
async function _saveFaceIndex(galleryId, prevFaces, newFaces, alreadyDone, processed) {
  const faces = prevFaces.concat(newFaces);
  const allPhotos = [...alreadyDone, ...processed];
  const { error } = await sb.from('face_indexes').upsert({
    gallery_id: galleryId,
    data: { faces, photos: allPhotos, qv: 1, built_at: new Date().toISOString() },
    face_count: faces.length, photo_count: allPhotos.length, updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return faces.length;
}

// Núcleo da indexação: processa em blocos e SALVA A CADA BLOCO. Antes salvava
// só no fim — 80 fotos levam ~20s e, se a aba fosse fechada ou o admin mudasse
// de tela antes disso, todo o trabalho era perdido e o álbum ficava pra sempre
// "sendo processado". Com salvamento parcial + fotos que falharam não entrando
// em `processed`, a próxima passada continua de onde parou.
const FACE_INDEX_CHUNK = 25;
async function _indexGallery(galleryId, onProgress) {
  await loadFaceApiAdmin();
  let { prevFaces, alreadyDone } = await _loadExistingIndex(galleryId);
  const photos = await _fetchGalleryPhotosForIndex(galleryId);
  const todo = photos.filter(p => !alreadyDone.has(p.id));
  if (!todo.length) return { todo: 0, added: 0, total: prevFaces.length, failed: 0, unsigned: 0 };

  let added = 0, failedAll = 0, unsignedAll = 0, base = 0;
  for (let i = 0; i < todo.length; i += FACE_INDEX_CHUNK) {
    const slice = todo.slice(i, i + FACE_INDEX_CHUNK);
    const { newFaces, processed, failed, unsignedCount } = await _detectFaces(slice, (d, _t, fc) => {
      if (onProgress) onProgress(base + d, todo.length, added + fc);
    });
    await _saveFaceIndex(galleryId, prevFaces, newFaces, alreadyDone, processed);
    prevFaces = prevFaces.concat(newFaces);
    processed.forEach(id => alreadyDone.add(id));
    added += newFaces.length; failedAll += failed; unsignedAll += (unsignedCount || 0);
    base += slice.length;
  }
  return { todo: todo.length, added, total: prevFaces.length, failed: failedAll, unsigned: unsignedAll };
}

// ── Botão manual (Configurações → Reconhecimento facial) ──
async function generateFaceIndex() {
  if (!currentSettingsGalleryId) return;
  const btn = document.getElementById('face-index-btn');
  const status = document.getElementById('face-index-status');
  const barWrap = document.getElementById('face-index-bar-wrap');
  const bar = document.getElementById('face-index-bar');
  btn.disabled = true; status.textContent = 'Carregando modelos...'; barWrap.style.display = 'block'; bar.style.width = '0';
  try {
    const r = await _indexGallery(currentSettingsGalleryId, (done, total, faceCount) => {
      bar.style.width = (done / total * 100) + '%';
      status.textContent = `Processando ${done}/${total} · +${faceCount} rosto(s)`;
    });
    if (!r.todo) { status.textContent = 'Índice já atualizado — nenhuma foto nova.'; barWrap.style.display = 'none'; return; }
    status.textContent = `Pronto: +${r.added} rosto(s) em ${r.todo} foto(s) novas. Total: ${r.total} rosto(s).`
      + (r.failed ? ` · ${r.failed} foto(s) falharam (serão tentadas de novo).` : '');
    if (r.unsigned) toast(`Atenção: ${r.unsigned} foto(s) não puderam ser assinadas — rode de novo.`, 'error');
    else toast('Índice facial atualizado!', 'success');
    loadFaceIndexInfo(currentSettingsGalleryId);
  } catch (e) {
    status.textContent = 'Erro: ' + (e.message || e);
    toast('Falha ao gerar índice', 'error');
  } finally {
    btn.disabled = false; setTimeout(() => { barWrap.style.display = 'none'; }, 1500);
  }
}

// ── Automático: chamado depois de qualquer upload (nova galeria, adicionar
// fotos, capa, lote) e também ao abrir uma galeria (cobre álbuns antigos que
// nunca passaram por isso) — silencioso, sem travar a tela, só avisa por
// toast quando termina. Roda em segundo plano (não é "await"ado por quem
// chama). _autoIndexInFlight evita processar a mesma galeria em duplicidade
// quando dois gatilhos disparam quase juntos (ex.: upload + reload da tela).
const _autoIndexInFlight = new Set();
async function autoIndexFaces(galleryId) {
  if (!galleryId || _autoIndexInFlight.has(galleryId)) return;
  _autoIndexInFlight.add(galleryId);
  try {
    const { data: g } = await sb.from('galleries').select('facial_recognition_enabled').eq('id', galleryId).maybeSingle();
    if (g && g.facial_recognition_enabled === false) return; // admin desligou pra essa galeria

    const gname = (Array.isArray(galleries) && (galleries.find(x => x.id === galleryId) || {}).name) || 'galeria';
    const r = await _indexGallery(galleryId, (done, total) => {
      _faceChip(`Indexando rostos — ${gname}: ${done}/${total}`);
    });
    _faceChipHide();
    if (!r.todo) return;
    if (r.unsigned) toast(`Índice facial: ${r.unsigned} foto(s) falharam ao assinar — abra a galeria de novo pra continuar.`, 'error');
    else if (r.added) toast(`Índice facial: +${r.added} rosto(s) em ${gname}`, '');
    if (typeof currentSettingsGalleryId !== 'undefined' && currentSettingsGalleryId === galleryId
        && typeof loadFaceIndexInfo === 'function') {
      loadFaceIndexInfo(galleryId);
    }
  } catch (e) {
    console.error('autoIndexFaces:', e);
    _faceChipHide();
  } finally {
    _autoIndexInFlight.delete(galleryId);
  }
}

// ── Botão "Escanear rostos" na tela da galeria (sob demanda) ──
// Mostra quantas fotos ainda faltam; quando está tudo em dia vira "Rostos: N ✓".
let _detailFacesRunning = false;
async function refreshDetailFacesBtn(galleryId) {
  const label = document.getElementById('detail-faces-label');
  const btn = document.getElementById('detail-faces-btn');
  if (!label || !btn || !galleryId) return;
  try {
    const [cnt, idxRes] = await Promise.all([
      sb.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId),
      sb.from('face_indexes').select('face_count,photo_count').eq('gallery_id', galleryId).maybeSingle(),
    ]);
    const total = cnt.count || 0;
    const idx = idxRes.data;
    const pending = Math.max(0, total - ((idx && idx.photo_count) || 0));
    btn.disabled = total === 0;
    label.textContent = !total ? 'Escanear rostos'
      : pending ? `Escanear rostos (${pending})`
      : `Rostos: ${(idx && idx.face_count) || 0} ✓`;
  } catch (e) {}
}

async function indexCurrentGalleryFaces() {
  if (!currentGalleryId || _detailFacesRunning) return;
  _detailFacesRunning = true;
  const btn = document.getElementById('detail-faces-btn');
  const bar = document.getElementById('detail-faces-bar');
  const fill = document.getElementById('detail-faces-fill');
  const status = document.getElementById('detail-faces-status');
  btn.disabled = true; bar.style.display = 'block'; fill.style.width = '0';
  status.textContent = 'Carregando modelos de reconhecimento...';
  try {
    const r = await _indexGallery(currentGalleryId, (done, total, faces) => {
      fill.style.width = (done / total * 100) + '%';
      status.textContent = `Procurando rostos: ${done}/${total} foto(s) · ${faces} rosto(s) encontrado(s)`;
    });
    if (!r.todo) {
      // Índice antigo foi feito com limiar mais permissivo (entrava bolo, estampa).
      // Refazer do zero é a única forma de aplicar os limiares novos.
      if (confirm('Todas as fotos já foram escaneadas.\n\nRefazer o escaneamento do zero? (usa os critérios novos, que descartam falsos rostos)')) {
        status.textContent = 'Apagando índice antigo...';
        const { error: delErr } = await sb.from('face_indexes').delete().eq('gallery_id', currentGalleryId);
        if (delErr) throw delErr;
        const r2 = await _indexGallery(currentGalleryId, (done, total, faces) => {
          fill.style.width = (done / total * 100) + '%';
          status.textContent = `Refazendo: ${done}/${total} foto(s) · ${faces} rosto(s)`;
        });
        status.textContent = `Refeito: ${r2.added} rosto(s) em ${r2.todo} foto(s).`;
        toast(`Escaneamento refeito: ${r2.added} rosto(s)`, 'success');
      } else {
        status.textContent = 'Todas as fotos já foram escaneadas.';
      }
    } else {
      status.textContent = `Pronto: +${r.added} rosto(s) em ${r.todo} foto(s).`
        + (r.failed ? ` ${r.failed} foto(s) falharam — clique de novo pra tentar.` : '');
      if (r.unsigned) toast(`${r.unsigned} foto(s) não puderam ser assinadas — rode de novo.`, 'error');
      else toast(`Escaneamento concluído: +${r.added} rosto(s)`, 'success');
    }
    refreshDetailFacesBtn(currentGalleryId);
  } catch (e) {
    status.textContent = 'Erro: ' + (e.message || e);
    toast('Falha ao escanear rostos', 'error');
  } finally {
    _detailFacesRunning = false;
    btn.disabled = false;
    setTimeout(() => { bar.style.display = 'none'; }, 5000);
  }
}

// ── Aviso flutuante de progresso (não bloqueia a tela) ──
function _faceChip(txt) {
  let el = document.getElementById('face-sweep-chip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'face-sweep-chip';
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:4000;background:var(--panel);'
      + 'border:1px solid var(--border);border-radius:9px;padding:9px 14px;color:var(--text);'
      + 'font-size:.72rem;font-family:var(--mono);box-shadow:0 4px 14px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.textContent = txt;
  el.style.display = 'block';
}
function _faceChipHide() {
  const el = document.getElementById('face-sweep-chip');
  if (el) el.style.display = 'none';
}

// ── Varredura automática de tudo que está pendente ──
// O uploader por linha de comando (Upload para Galeria.command) não roda
// face-api — quem sobe por lá nunca dispara autoIndexFaces. Esta varredura
// roda ao abrir o painel e pega qualquer álbum com fotos ainda sem índice,
// um de cada vez. Quando está tudo em dia, custa só uma consulta.
let _sweepInFlight = false;
async function sweepPendingFaceIndexes() {
  if (_sweepInFlight || !Array.isArray(galleries) || !galleries.length) return;
  _sweepInFlight = true;
  try {
    const { data: idx } = await sb.from('face_indexes').select('gallery_id,photo_count');
    const indexed = {};
    (idx || []).forEach(r => { indexed[r.gallery_id] = r.photo_count || 0; });
    const pending = galleries.filter(g =>
      g.facial_recognition_enabled !== false && (g._count || 0) > (indexed[g.id] || 0));
    if (!pending.length) return;
    console.log(`face-index: ${pending.length} álbum(ns) com fotos sem índice — indexando em segundo plano.`);
    for (const g of pending) await autoIndexFaces(g.id);
  } catch (e) {
    console.error('sweepPendingFaceIndexes:', e);
  } finally {
    _sweepInFlight = false;
    _faceChipHide();
  }
}
