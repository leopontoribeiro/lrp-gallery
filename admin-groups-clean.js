// ============================================================
// GRUPOS DE GALERIA — versão limpa (tema escuro do admin).
// Grupo = "galeria-mãe" (nome, link próprio grupo.html?t=, on/off).
// Álbuns (filhas) = galerias normais com galleries.gallery_group_id.
// Depende de globals do admin: sb, toast, esc, BASE_URL, signUrls,
// currentGalleryId, openDetail, goTo.
// ============================================================

function _groupToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function _groupLink(token) { return `${BASE_URL}/grupo.html?t=${token}`; }
function _slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
async function _uniqueSlug(base) {
  let slug = base || 'album', out = slug, n = 2;
  while (true) {
    const { data } = await sb.from('galleries').select('id').eq('slug', out).maybeSingle();
    if (!data) return out;
    out = slug + '-' + (n++);
  }
}

// ── Criar grupo (mãe) ──
async function createGroupClean() {
  const name = prompt('Nome do grupo (galeria-mãe):', '');
  if (name == null) return;
  const clean = name.trim();
  if (!clean) { toast('O nome não pode ficar vazio', 'error'); return; }
  const { error } = await sb.from('gallery_groups')
    .insert({ name: clean, access_token: _groupToken(), status: 'live' });
  if (error) { toast('Erro ao criar grupo: ' + error.message, 'error'); return; }
  toast('Grupo criado', 'success');
  if (typeof goTo === 'function') goTo('groups');
  renderGroupsClean();
}

// ── Criar álbum (galeria) DENTRO do grupo ──
async function createAlbumInGroup(groupId) {
  const name = prompt('Nome do álbum dentro do grupo:', '');
  if (name == null) return;
  const clean = name.trim();
  if (!clean) { toast('O nome não pode ficar vazio', 'error'); return; }
  const slug = await _uniqueSlug(_slugify(clean));
  const { data, error } = await sb.from('galleries').insert({
    name: clean, slug, status: 'live', access_token: _groupToken(), gallery_group_id: groupId
  }).select().single();
  if (error) { toast('Erro ao criar álbum: ' + error.message, 'error'); return; }
  toast('Álbum criado — abra para enviar as fotos', 'success');
  renderGroupsClean();
  if (typeof openDetail === 'function' && data) openDetail(data.id);
}

// ── Render principal ──
async function renderGroupsClean() {
  const container = document.getElementById('gallery-groups-container');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted);padding:16px">Carregando grupos…</div>';

  const { data: groups, error } = await sb.from('gallery_groups')
    .select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { container.innerHTML = '<div style="color:#ff6a6a;padding:16px">Erro: ' + esc(error.message) + '</div>'; return; }

  // Filhas (álbuns) de cada grupo, com capa assinada
  const kidsByGroup = {};
  await Promise.all((groups || []).map(async gr => {
    const { data: kids } = await sb.from('galleries')
      .select('id,name,date,cover_photo_id,gallery_group_id,access_token')
      .eq('gallery_group_id', gr.id).is('deleted_at', null)
      .order('created_at', { ascending: false });
    for (const k of (kids || [])) {
      const q = k.cover_photo_id
        ? sb.from('photos').select('thumb_url').eq('id', k.cover_photo_id).maybeSingle()
        : sb.from('photos').select('thumb_url').eq('gallery_id', k.id).order('position').limit(1).maybeSingle();
      const { data: cov } = await q;
      k._thumb = cov?.thumb_url || null;
      const { count } = await sb.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', k.id);
      k._count = count || 0;
    }
    const signed = await signUrls((kids || []).map(k => k._thumb || ''));
    (kids || []).forEach((k, i) => { if (k._thumb) k._thumb = signed[i] || k._thumb; });
    kidsByGroup[gr.id] = kids || [];
  }));

  const btn = (label, onclick, accent) =>
    `<button onclick="${onclick}" style="padding:7px 12px;font-size:.66rem;border-radius:7px;cursor:pointer;border:1px solid var(--border);` +
    (accent ? 'background:var(--accent);color:#0d0d0d;border-color:var(--accent);font-weight:700' : 'background:transparent;color:var(--text)') +
    `">${label}</button>`;

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap">
      <div style="color:var(--muted);font-size:.8rem">${(groups || []).length} grupo(s)</div>
      ${btn('+ Criar grupo', 'createGroupClean()', true)}
    </div>`;

  if (!groups || !groups.length) {
    html += '<div style="color:var(--muted);padding:28px;text-align:center">Nenhum grupo ainda. Clique em “Criar grupo”.</div>';
    container.innerHTML = html; return;
  }

  for (const gr of groups) {
    const on = gr.status === 'live';
    const nm = esc(gr.name).replace(/'/g, "\\'");
    const dt = gr.created_at ? new Date(gr.created_at).toLocaleDateString('pt-BR') : '';
    const kids = kidsByGroup[gr.id] || [];

    // Cabeçalho do grupo
    html += `<section style="background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="color:var(--text);font-size:1.15rem;font-weight:800;letter-spacing:.3px">${esc(gr.name)}</div>
          <div style="color:var(--muted);font-size:.72rem;margin-top:4px">
            criado em ${dt} · ${kids.length} álbum(ns) ·
            <span style="color:${on ? 'var(--green)' : 'var(--muted)'}">${on ? 'compartilhado' : 'desligado'}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${btn('Criar álbum', `createAlbumInGroup('${gr.id}')`, true)}
          ${btn('Copiar link', `copyGroupLink('${gr.access_token}')`)}
          ${btn('QR Code', `groupQR('${gr.access_token}')`)}
          ${btn('Renomear', `renameGroupClean('${gr.id}')`)}
          ${btn(on ? 'Desligar' : 'Ligar', `toggleGroupShareClean('${gr.id}','${gr.status}')`)}
          ${btn('Apagar', `deleteGroupClean('${gr.id}','${nm}')`)}
        </div>
      </div>
      <div style="color:var(--muted);font-size:.66rem;margin-top:10px;word-break:break-all">${esc(_groupLink(gr.access_token))}</div>`;

    // Cards dos álbuns (estilo portfólio)
    if (!kids.length) {
      html += `<div style="color:var(--muted);font-size:.75rem;padding:16px 2px 2px">Nenhum álbum ainda — clique em “Criar álbum”.</div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:16px">`;
      for (const k of kids) {
        const thumb = k._thumb || 'https://picsum.photos/300/200?random=' + k.id;
        html += `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)">
            <div onclick="openDetail('${k.id}')" style="cursor:pointer;aspect-ratio:3/2;background:#1c1c1c">
              <img src="${thumb}" alt="${esc(k.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">
            </div>
            <div onclick="openDetail('${k.id}')" style="cursor:pointer;padding:9px 11px">
              <div style="color:var(--text);font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(k.name)}</div>
              <div style="color:var(--muted);font-size:.66rem;margin-top:2px">${k._count || 0} fotos</div>
            </div>
            <div style="padding:0 11px 9px">
              <button onclick="event.stopPropagation();copyKidLink('${k.access_token}')" style="width:100%;padding:6px 8px;font-size:.62rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)">Compartilhar</button>
            </div>
          </div>`;
      }
      html += `</div>`;
    }
    html += `</section>`;
  }
  container.innerHTML = html;
}

function copyGroupLink(token) {
  navigator.clipboard.writeText(_groupLink(token)).then(() => toast('Link do grupo copiado!', 'success'));
}

function copyKidLink(token) {
  navigator.clipboard.writeText(`${BASE_URL}/gallery.html?t=${token}`).then(() => toast('Link da galeria copiado!', 'success'));
}

function showQRForLink(link) {
  const api = s => `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=10&data=${encodeURIComponent(link)}`;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.onclick = () => modal.remove();
  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px;text-align:center;max-width:320px">
      <div style="color:var(--text);font-weight:700;margin-bottom:14px">QR Code do grupo</div>
      <img src="${api(260)}" alt="QR" style="width:260px;height:260px;background:#fff;border-radius:8px;padding:6px">
      <a href="${api(600)}" download="qr-grupo.png" target="_blank" style="display:inline-block;margin-top:16px;padding:9px 16px;background:var(--accent);color:#0d0d0d;border-radius:8px;text-decoration:none;font-weight:700;font-size:.78rem">Baixar QR</a>
      <button onclick="this.closest('div').parentNode.remove()" style="display:block;margin:12px auto 0;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.74rem">Fechar</button>
    </div>`;
  document.body.appendChild(modal);
}
function groupQR(token) { showQRForLink(_groupLink(token)); }

async function renameGroupClean(id) {
  const name = prompt('Novo nome do grupo:', '');
  if (name == null) return;
  const clean = name.trim();
  if (!clean) { toast('Nome vazio', 'error'); return; }
  const { error } = await sb.from('gallery_groups').update({ name: clean }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Grupo renomeado', 'success'); renderGroupsClean();
}

async function toggleGroupShareClean(id, status) {
  const next = status === 'live' ? 'draft' : 'live';
  const { error } = await sb.from('gallery_groups').update({ status: next }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(next === 'live' ? 'Grupo compartilhado' : 'Grupo desligado', next === 'live' ? 'success' : '');
  renderGroupsClean();
}

async function deleteGroupClean(id, name) {
  if (!confirm(`Apagar o grupo "${name}"? Os álbuns dentro dele NÃO são apagados — só saem do grupo.`)) return;
  const { error } = await sb.from('gallery_groups')
    .update({ deleted_at: new Date().toISOString(), status: 'draft' }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  await sb.from('galleries').update({ gallery_group_id: null }).eq('gallery_group_id', id);
  toast('Grupo apagado', 'error'); renderGroupsClean();
}

// Adiciona a galeria aberta (currentGalleryId) a um grupo, ou remove.
async function assignGalleryToGroup() {
  if (typeof currentGalleryId === 'undefined' || !currentGalleryId) { toast('Abra uma galeria primeiro', 'error'); return; }
  const { data: groups } = await sb.from('gallery_groups')
    .select('id,name').is('deleted_at', null).order('created_at', { ascending: false });
  if (!groups || !groups.length) { toast('Crie um grupo primeiro (menu Grupos)', 'error'); return; }
  const lines = groups.map((g, i) => `${i + 1}) ${g.name}`).join('\n');
  const ans = prompt(`Adicionar esta galeria a qual grupo?\n\n${lines}\n\n0) Remover de qualquer grupo\n\nDigite o número:`, '1');
  if (ans == null) return;
  const n = parseInt(ans, 10);
  let gid = null;
  if (n === 0) gid = null;
  else if (n >= 1 && n <= groups.length) gid = groups[n - 1].id;
  else { toast('Opção inválida', 'error'); return; }
  const { error } = await sb.from('galleries').update({ gallery_group_id: gid }).eq('id', currentGalleryId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(gid ? 'Galeria adicionada ao grupo' : 'Galeria removida do grupo', 'success');
}
