// ── PESSOAS (agrupamento de rostos, estilo Google Fotos) ──
// Reaproveita o índice facial que já existe: cada rosto tem o vetor de 128
// números (d) e a caixa dele na foto (b). Agrupamos vetores parecidos, mostramos
// o recorte do rosto e, ao nomear, a etiqueta vira grupo em todas as fotos
// daquela pessoa (mesmo mecanismo do "Aplicar grupo": parseTags/joinTags).
//
// Depende de globals do admin (sb, toast, esc, signUrls, currentGalleryId,
// parseTags, joinTags, openDetail).

// Distância pra considerar "mesma pessoa". 0.46 é o limiar que o cliente usa
// pra dizer "é você"; aqui usamos um pouco mais folgado porque iluminação e
// ângulo variam muito num evento. Dois grupos que forem a mesma pessoa podem
// receber o MESMO nome — a etiqueta se funde sozinha, sem UI de "mesclar".
// Calibrado com fotos reais (40 fotos, 45 rostos): em 0.52 o maior grupo pulava
// de 11 pra 16 fotos — era ali que duas pessoas viravam uma etiqueta só. Em 0.44
// o efeito oposto: a pessoa principal se quebrava em 6 pedaços. 0.46 mantém a
// pessoa inteira sem misturar, e é o mesmo limiar que o cliente usa pra dizer
// "é você". Se ainda sobrar gente dividida, dar o mesmo nome funde os cards.
const PEOPLE_THRESHOLD = 0.46;
const PEOPLE_MIN_SCORE = 0.65;   // descarta detecção duvidosa (bolo, estampa, etc.)
const PEOPLE_MIN_W = 0.05;       // e rosto pequeno demais pro vetor ser confiável
// Até onde vamos procurar "será que também é ela?" depois de nomear alguém.
// Entre PEOPLE_THRESHOLD e isto fica a zona de dúvida — que a gente pergunta
// em vez de decidir sozinho (mesma ideia do "talvez" da busca do cliente).
const PEOPLE_MAYBE = 0.62;
// Reconhecer alguém já nomeado é mais arriscado que agrupar: aqui o erro
// escreve o nome errado na foto sozinho. Medido nas fotos reais, os grupos
// certos ficam abaixo de 0.34 e o primeiro grupo de OUTRA pessoa aparece em
// 0.461 — 0.46 deixaria margem de 0.001. Com 0.40 pego as mesmas fotos e
// fico a 0.06 de distância do erro.
const PEOPLE_RECOGNIZE = 0.40;
let _peopleClusters = [];
let _peopleIgnored = new Set();
let _peopleFaces = [];      // todos os rostos válidos (p/ sugerir mais fotos)
let _peopleThumbs = {};     // cache photoId -> thumb assinada
let _peopleMemoria = [];    // pessoas já nomeadas/ignoradas nesta galeria

// ── Memória: quem já foi identificado nesta galeria ──
// Guarda o "centro" do rosto de cada pessoa. Na próxima abertura, grupo que
// bate com um centro já vem nomeado — e o que foi ignorado segue escondido.
async function _carregarMemoria(galleryId) {
  try {
    const { data } = await sb.from('gallery_people')
      .select('id,name,centroid,ignored,photo_count').eq('gallery_id', galleryId);
    _peopleMemoria = (data || []).map(p => ({ ...p, c: (p.centroid || []).map(v => v / 127) }));
  } catch (e) { _peopleMemoria = []; }   // migração 32 ainda não rodou: segue sem memória
}

async function _gravarMemoria(galleryId, nome, centroid, ignorado, nFotos) {
  const q1 = x => Math.max(-127, Math.min(127, Math.round(x * 127)));
  const linha = {
    gallery_id: galleryId, name: nome || null, ignored: !!ignorado,
    centroid: centroid.map(q1), photo_count: nFotos || 0, updated_at: new Date().toISOString(),
  };
  try {
    // Mesmo nome na mesma galeria = atualiza (o índice único cuida disso).
    const existente = nome && _peopleMemoria.find(p => p.name === nome);
    if (existente) await sb.from('gallery_people').update(linha).eq('id', existente.id);
    else await sb.from('gallery_people').insert(linha);
  } catch (e) { console.warn('não consegui guardar a pessoa:', e.message); }
}

// Qual pessoa conhecida bate com este grupo? (null se nenhuma)
function _reconhecer(centroid) {
  let melhor = null, dist = Infinity;
  for (const p of _peopleMemoria) {
    if (!p.c || p.c.length !== centroid.length) continue;
    const d = _euclid(centroid, p.c);
    if (d < dist) { dist = d; melhor = p; }
  }
  return (melhor && dist < PEOPLE_RECOGNIZE) ? { ...melhor, dist } : null;
}

function _euclid(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

// Agrupamento guloso + 2 passadas de refinamento (estilo k-means): a primeira
// passada depende da ordem, o refinamento corrige quem caiu no grupo errado.
function _clusterFaces(faces, threshold = PEOPLE_THRESHOLD) {
  let clusters = [];
  for (const f of faces) {
    let best = null, bestDist = Infinity;
    for (const c of clusters) {
      const dist = _euclid(f.d, c.centroid);
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    if (best && bestDist < threshold) {
      best.faces.push(f);
      const n = best.faces.length;
      for (let i = 0; i < f.d.length; i++) best.centroid[i] += (f.d[i] - best.centroid[i]) / n;
    } else {
      clusters.push({ centroid: f.d.slice(), faces: [f] });
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const next = clusters.map(c => ({ centroid: c.centroid, faces: [] }));
    for (const f of faces) {
      let bi = -1, bd = Infinity;
      next.forEach((c, i) => { const d = _euclid(f.d, c.centroid); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd < threshold) next[bi].faces.push(f);
      else next.push({ centroid: f.d.slice(), faces: [f] });
    }
    clusters = next.filter(c => c.faces.length);
    for (const c of clusters) {
      const dim = c.faces[0].d.length;
      const cen = new Array(dim).fill(0);
      for (const f of c.faces) for (let i = 0; i < dim; i++) cen[i] += f.d[i];
      for (let i = 0; i < dim; i++) cen[i] /= c.faces.length;
      c.centroid = cen;
    }
  }

  // Uma pessoa pode aparecer 2x na mesma foto: contamos fotos únicas.
  for (const c of clusters) {
    c.photoIds = [...new Set(c.faces.map(f => f.p))];
    // representante = rosto maior (costuma ser o mais nítido e de frente)
    c.rep = c.faces.reduce((a, b) => ((b.b && b.b[2] * b.b[3]) > (a.b && a.b[2] * a.b[3]) ? b : a), c.faces[0]);
  }
  return clusters.sort((a, b) => b.photoIds.length - a.photoIds.length);
}

async function openPeople() {
  if (!currentGalleryId) return;
  const modal = document.getElementById('people-modal');
  const body = document.getElementById('people-body');
  modal.style.display = 'flex';
  body.innerHTML = '<div style="color:var(--muted);padding:24px">Carregando índice facial…</div>';
  _peopleIgnored = new Set();

  try {
    const { data: idx } = await sb.from('face_indexes').select('data').eq('gallery_id', currentGalleryId).maybeSingle();
    const raw = idx && idx.data && Array.isArray(idx.data.faces) ? idx.data.faces : null;
    if (!raw || !raw.length) {
      body.innerHTML = '<div style="color:var(--muted);padding:24px">Nenhum rosto indexado ainda.<br>Use o botão <b>Escanear rostos</b> primeiro.</div>';
      return;
    }
    // Índice novo guarda o vetor quantizado (qv:1) — desfaz pra float.
    const q = idx.data.qv === 1;
    const all = raw.filter(f => Array.isArray(f.d)).map(f => ({
      p: f.p, b: f.b, s: f.s, d: q ? f.d.map(v => v / 127) : f.d,
    }));
    // Índices antigos não têm `s` — nesses só dá pra filtrar por tamanho.
    const faces = all.filter(f =>
      (f.s == null || f.s >= PEOPLE_MIN_SCORE) &&
      (!Array.isArray(f.b) || f.b[2] >= PEOPLE_MIN_W));
    const dropped = all.length - faces.length;
    if (dropped) console.log(`Pessoas: ${dropped} detecção(ões) fraca(s) descartada(s).`);

    body.innerHTML = '<div style="color:var(--muted);padding:24px">Agrupando ' + faces.length + ' rosto(s)…</div>';
    await new Promise(r => setTimeout(r, 20));   // deixa a UI pintar
    _peopleFaces = faces;
    _peopleThumbs = {};
    await _carregarMemoria(currentGalleryId);
    _peopleClusters = _clusterFaces(faces);
    // Casa cada grupo com quem já foi identificado antes.
    _peopleClusters.forEach((c, i) => {
      const conhecido = _reconhecer(c.centroid);
      c.conhecido = conhecido;
      if (conhecido && conhecido.ignored) _peopleIgnored.add(i);
    });
    await _renderPeople();
  } catch (e) {
    body.innerHTML = '<div style="color:#ff6a6a;padding:24px">Erro: ' + esc(e.message || String(e)) + '</div>';
  }
}
function closePeople() { document.getElementById('people-modal').style.display = 'none'; }

async function _renderPeople() {
  const body = document.getElementById('people-body');
  const showSingles = document.getElementById('people-singles').checked;
  const list = _peopleClusters
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => !_peopleIgnored.has(i) && (showSingles || c.photoIds.length > 1));

  if (!list.length) {
    body.innerHTML = '<div style="color:var(--muted);padding:24px">Nenhuma pessoa com mais de uma foto. Marque "mostrar quem aparece 1x" para ver o resto.</div>';
    return;
  }

  // Miniatura do representante de cada grupo (assinada).
  const repIds = [...new Set(list.map(({ c }) => c.rep.p))];
  const { data: photos } = await sb.from('photos').select('id,thumb_url').in('id', repIds);
  const signed = await signUrls((photos || []).map(p => p.thumb_url));
  const thumbById = {};
  (photos || []).forEach((p, k) => { thumbById[p.id] = signed[k] || p.thumb_url; });

  body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px">
    ${list.map(({ c, i }) => `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:11px;padding:12px;text-align:center">
        <canvas id="pface-${i}" width="150" height="150"
          style="width:100%;aspect-ratio:1;border-radius:9px;background:var(--bg);display:block;object-fit:cover"></canvas>
        <div style="font-size:.68rem;color:var(--muted);margin:8px 0 6px">${c.photoIds.length} foto(s)${
          c.conhecido && c.conhecido.name ? ` · <span style="color:var(--green)">✓ já identificada</span>` : ''}</div>
        <input id="pname-${i}" placeholder="Nome da pessoa" value="${c.conhecido && c.conhecido.name ? esc(c.conhecido.name) : ''}"
          style="width:100%;background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:7px 9px;color:var(--text);font-size:.75rem;outline:none;box-sizing:border-box">
        <div style="display:flex;gap:6px;margin-top:7px">
          <button class="btn btn-primary" style="flex:1;padding:7px;font-size:.65rem" onclick="applyPerson(${i})">${
            c.conhecido && c.conhecido.name ? 'Aplicar de novo' : 'Criar grupo'}</button>
          <button class="btn btn-ghost" style="padding:7px 9px;font-size:.65rem" onclick="ignorePerson(${i})" title="Esconder (não é uma pessoa / não interessa)">✕</button>
        </div>
      </div>`).join('')}
  </div>`;

  for (const { c, i } of list) _drawFaceCrop(`pface-${i}`, thumbById[c.rep.p], c.rep.b);
}

// Recorta o rosto no canvas — a caixa (b) está em 0..1, então funciona em
// qualquer tamanho de imagem.
function _drawFaceCrop(canvasId, url, box) {
  if (!url) return;
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const [bx, by, bw, bh] = box || [0.25, 0.25, 0.5, 0.5];
    const W = img.naturalWidth, H = img.naturalHeight;
    // quadrado centrado no rosto, com folga pra pegar cabelo/queixo
    const cx = (bx + bw / 2) * W, cy = (by + bh / 2) * H;
    const side = Math.min(Math.max(bw * W, bh * H) * 1.7, Math.min(W, H));
    const sx = Math.max(0, Math.min(W - side, cx - side / 2));
    const sy = Math.max(0, Math.min(H - side, cy - side / 2));
    cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, cv.width, cv.height);
  };
  img.src = url;
}

// Miniaturas assinadas, com cache (a revisão pode pedir dezenas de fotos).
async function _thumbsFor(photoIds) {
  const miss = photoIds.filter(id => !_peopleThumbs[id]);
  if (miss.length) {
    const { data: rows } = await sb.from('photos').select('id,thumb_url').in('id', miss);
    const signed = await signUrls((rows || []).map(r => r.thumb_url));
    (rows || []).forEach((r, k) => { _peopleThumbs[r.id] = signed[k] || r.thumb_url; });
  }
  return _peopleThumbs;
}

function togglePeopleSingles() { _renderPeople(); }

async function ignorePerson(i) {
  _peopleIgnored.add(i);
  const c = _peopleClusters[i];
  // Lembra que este rosto não interessa, pra não reaparecer na próxima abertura.
  if (c && c.centroid) await _gravarMemoria(currentGalleryId, null, c.centroid, true, c.photoIds.length);
  _renderPeople();
}

// Aplica o nome como etiqueta de grupo em todas as fotos da pessoa.
// Se dois grupos receberem o mesmo nome, as fotos se juntam sozinhas.
async function applyPerson(i) {
  const c = _peopleClusters[i];
  if (!c) return;
  const input = document.getElementById(`pname-${i}`);
  const name = (input.value || '').trim();
  if (!name) { toast('Digite o nome da pessoa', 'error'); input.focus(); return; }

  const ids = c.photoIds;
  const { data: rows, error } = await sb.from('photos').select('id,group_name').in('id', ids);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }

  let n = 0;
  for (const r of rows) {
    const tags = parseTags(r.group_name);
    if (tags.includes(name)) continue;
    const { error: upErr } = await sb.from('photos')
      .update({ group_name: joinTags([...tags, name]) }).eq('id', r.id);
    if (!upErr) n++;
  }
  toast(`"${name}" aplicado a ${n} foto(s)`, 'success');
  await _gravarMemoria(currentGalleryId, name, c.centroid, false, ids.length);
  await _carregarMemoria(currentGalleryId);   // recarrega pra reconhecer daqui pra frente
  _peopleIgnored.add(i);
  await reviewMore(i, name);
}

// ── "Também é ela?" ──
// O agrupamento é conservador de propósito (não mistura pessoas), então a mesma
// pessoa costuma sobrar em vários cards. Aqui pegamos os rostos na zona de
// dúvida em relação ao grupo já nomeado e perguntamos, em vez de adivinhar.
let _reviewCands = [];
async function reviewMore(i, name) {
  const c = _peopleClusters[i];
  const body = document.getElementById('people-body');
  if (!c) return _renderPeople();

  const already = new Set(c.photoIds);
  const best = {};   // photoId -> rosto mais parecido daquela foto
  for (const f of _peopleFaces) {
    if (already.has(f.p)) continue;
    const dist = _euclid(f.d, c.centroid);
    if (dist >= PEOPLE_THRESHOLD && dist < PEOPLE_MAYBE) {
      if (!best[f.p] || dist < best[f.p].dist) best[f.p] = { f, dist };
    }
  }
  _reviewCands = Object.values(best).sort((a, b) => a.dist - b.dist);
  if (!_reviewCands.length) return _renderPeople();

  const thumbs = await _thumbsFor(_reviewCands.map(x => x.f.p));
  body.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="color:var(--text);font-weight:700">Também é ${esc(name)}?</div>
      <div style="font-size:.68rem;color:var(--muted);margin-top:3px">
        Marcadas as mais parecidas. Desmarque quem não for e confirme — assim
        "${esc(name)}" pega as fotos que o agrupamento deixou de fora.
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">
      ${_reviewCands.map((x, k) => `
        <label style="cursor:pointer;display:block;text-align:center">
          <canvas id="rface-${k}" width="120" height="120"
            style="width:100%;aspect-ratio:1;border-radius:9px;background:var(--bg);display:block"></canvas>
          <div style="margin-top:5px;font-size:.62rem;color:var(--muted)">
            <input type="checkbox" id="rchk-${k}" ${x.dist < 0.54 ? 'checked' : ''}> ${(1 - x.dist).toFixed(2)}
          </div>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;position:sticky;bottom:0;background:var(--panel);padding-top:10px">
      <button class="btn btn-primary" data-person="${esc(name)}" data-idx="${i}" onclick="confirmMore(this.dataset.person, Number(this.dataset.idx))">Adicionar selecionadas</button>
      <button class="btn btn-ghost" onclick="_renderPeople()">Pular</button>
    </div>`;

  _reviewCands.forEach((x, k) => _drawFaceCrop(`rface-${k}`, thumbs[x.f.p], x.f.b));
}

async function confirmMore(name, idx) {
  const aceitos = _reviewCands.filter((_, k) => document.getElementById(`rchk-${k}`)?.checked);
  const ids = aceitos.map(x => x.f.p);
  if (!ids.length) return _renderPeople();
  const { data: rows, error } = await sb.from('photos').select('id,group_name').in('id', ids);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  let n = 0;
  for (const r of rows) {
    const tags = parseTags(r.group_name);
    if (tags.includes(name)) continue;
    const { error: e } = await sb.from('photos').update({ group_name: joinTags([...tags, name]) }).eq('id', r.id);
    if (!e) n++;
  }
  toast(`+${n} foto(s) em "${name}"`, 'success');

  // Rostos confirmados por você valem mais que o palpite inicial: entram na
  // média do "centro" da pessoa, então o reconhecimento melhora a cada uso.
  const c = _peopleClusters[idx];
  if (c && c.centroid && aceitos.length) {
    const dim = c.centroid.length;
    const novo = c.centroid.slice();
    const base = c.faces.length;
    aceitos.forEach((a, k) => {
      const peso = base + k + 1;
      for (let j = 0; j < dim; j++) novo[j] += (a.f.d[j] - novo[j]) / peso;
    });
    await _gravarMemoria(currentGalleryId, name, novo, false, c.photoIds.length + ids.length);
    await _carregarMemoria(currentGalleryId);
  }
  _renderPeople();
}
