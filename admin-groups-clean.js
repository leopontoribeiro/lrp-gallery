// ============================================================
// GRUPOS DE GALERIA — versão limpa, sobre a tabela gallery_groups.
// Cada grupo = "galeria-mãe" (nome, capa, link próprio grupo.html?t=,
// on/off). As filhas são galerias normais com galleries.gallery_group_id.
// Depende de globals do admin: sb, toast, esc, BASE_URL, currentGalleryId, goTo.
// ============================================================

function _groupToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
function _groupLink(token) { return `${BASE_URL}/grupo.html?t=${token}`; }

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

async function renderGroupsClean() {
  const container = document.getElementById('gallery-groups-container');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted);padding:16px">Carregando grupos…</div>';

  const { data: groups, error } = await sb.from('gallery_groups')
    .select('*').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) { container.innerHTML = '<div style="color:var(--red);padding:16px">Erro: ' + esc(error.message) + '</div>'; return; }

  await Promise.all((groups || []).map(async gr => {
    const { count } = await sb.from('galleries')
      .select('*', { count: 'exact', head: true })
      .eq('gallery_group_id', gr.id).is('deleted_at', null);
    gr._kids = count || 0;
  }));

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
    <div style="font-size:.8rem;color:var(--muted)">${(groups || []).length} grupo(s)</div>
    <button class="btn btn-primary" onclick="createGroupClean()" style="padding:8px 14px;font-size:.7rem">+ Criar grupo</button>
  </div>`;

  if (!groups || groups.length === 0) {
    html += '<div style="color:var(--muted);padding:24px;text-align:center">Nenhum grupo ainda. Clique em “Criar grupo”.</div>';
  } else {
    html += '<div style="display:grid;gap:12px">';
    for (const gr of groups) {
      const on = gr.status === 'live';
      const nameEsc = esc(gr.name).replace(/'/g, "\\'");
      html += `<div style="background:var(--card,#fff);border:1px solid var(--border,#eee);border-radius:12px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700">${esc(gr.name)}</div>
            <div style="font-size:.72rem;color:var(--muted)">${gr._kids} galeria(s) · ${on ? 'compartilhado' : 'desligado'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:.65rem" onclick="copyGroupLink('${gr.access_token}')">Copiar link</button>
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:.65rem" onclick="renameGroupClean('${gr.id}')">Renomear</button>
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:.65rem" onclick="toggleGroupShareClean('${gr.id}','${gr.status}')">${on ? 'Desligar' : 'Ligar'}</button>
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:.65rem" onclick="deleteGroupClean('${gr.id}','${nameEsc}')">Apagar</button>
          </div>
        </div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:8px;word-break:break-all">${esc(_groupLink(gr.access_token))}</div>
      </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

function copyGroupLink(token) {
  navigator.clipboard.writeText(_groupLink(token)).then(() => toast('Link do grupo copiado!', 'success'));
}

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
  if (!confirm(`Apagar o grupo "${name}"? As galerias dentro dele NÃO são apagadas — só saem do grupo.`)) return;
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
