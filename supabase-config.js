// ============================================================
// LRP SMART GALLERY — Supabase Integration Layer
// Substitui o localStorage do admin.html e gallery.html
//
// SETUP:
//   1. Crie um projeto em supabase.com
//   2. Copie URL e anon key em: Settings → API
//   3. Cole os valores abaixo
//   4. Inclua este arquivo antes do seu script:
//      <script src="supabase-config.js"></script>
// ============================================================

// ── SUAS CREDENCIAIS (preencha após criar o projeto) ────────
const SUPABASE_URL  = 'https://vtblxwaxwuztehtxkygp.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ymx4d2F4d3V6dGVodHhreWdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDQzMjMsImV4cCI6MjA5NjUyMDMyM30.0oscbNInwJzc2YN5eDYN76IBXvR0cTDbaLe4LDe0aKw';
const STORAGE_BUCKET = 'gallery-photos';

// ── INIT ────────────────────────────────────────────────────
// Carrega o SDK via CDN (sem npm, sem build step)
// Já incluído automaticamente se você usar o script abaixo no HTML:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>

let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabase;
}


// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════

/**
 * Login com email + senha (você, no painel admin)
 * Crie o usuário em: Supabase → Authentication → Users → Add user
 */
async function authLogin(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function authLogout() {
  const sb = getSupabase();
  await sb.auth.signOut();
}

async function authGetSession() {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}


// ════════════════════════════════════════════════════════════
// GALLERIES CRUD
// ════════════════════════════════════════════════════════════

/**
 * Listar todas as galerias (admin: todas | público: só live)
 */
async function galleriesGetAll() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('galleries')
    .select(`
      *,
      photos(id, thumb_url, position)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * Buscar galeria por slug (link do cliente)
 */
async function galleryGetBySlug(slug) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('galleries')
    .select(`
      *,
      photos(id, filename, storage_path, thumb_url, full_url, position)
    `)
    .eq('slug', slug)
    .eq('status', 'live')
    .single();

  if (error) throw error;

  // Ordenar fotos por position
  if (data?.photos) {
    data.photos.sort((a, b) => a.position - b.position);
  }

  return data;
}

/**
 * Criar nova galeria
 */
async function galleryCreate({ name, date, location }) {
  const sb = getSupabase();

  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const { data, error } = await sb
    .from('galleries')
    .insert({ name, slug, date, location, status: 'live' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Atualizar galeria (nome, status, cover_url, etc.)
 */
async function galleryUpdate(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('galleries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Excluir galeria (fotos deletadas em cascata pelo banco)
 */
async function galleryDelete(id) {
  const sb = getSupabase();

  // 1. Busca caminhos dos arquivos para deletar do storage
  const { data: photos } = await sb
    .from('photos')
    .select('storage_path')
    .eq('gallery_id', id);

  // 2. Remove arquivos do storage
  if (photos?.length > 0) {
    const paths = photos.map(p => p.storage_path);
    await sb.storage.from(STORAGE_BUCKET).remove(paths);
  }

  // 3. Deleta galeria (fotos deletadas em cascata)
  const { error } = await sb
    .from('galleries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}


// ════════════════════════════════════════════════════════════
// PHOTOS — UPLOAD & MANAGEMENT
// ════════════════════════════════════════════════════════════

/**
 * Fazer upload de uma foto para o Storage e salvar metadados no banco
 *
 * @param {File}   file       — objeto File do input
 * @param {string} galleryId  — UUID da galeria
 * @param {number} position   — ordem de exibição
 * @param {function} onProgress — callback(percent) para barra de progresso
 */
async function photoUpload(file, galleryId, position = 0, onProgress = null) {
  const sb = getSupabase();

  // Gera path único: galleries/{galleryId}/{timestamp}_{filename}
  const ext       = file.name.split('.').pop().toLowerCase();
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path      = `galleries/${galleryId}/${Date.now()}_${safeName}`;

  // Upload para Storage
  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (uploadError) throw uploadError;

  // Gera URL pública
  const { data: urlData } = sb.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path);

  const fullUrl = urlData.publicUrl;

  // URL de thumbnail via Supabase Image Transformation
  // IMPORTANTE: width+height+resize=contain — só width distorce a imagem
  const { data: thumbData } = sb.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(path, {
      transform: {
        width: 800,
        height: 800,
        resize: 'contain',
        quality: 80,
        format: 'webp',
      }
    });

  const thumbUrl = thumbData.publicUrl;

  // Salva metadados no banco
  const { data, error: dbError } = await sb
    .from('photos')
    .insert({
      gallery_id:   galleryId,
      filename:     file.name,
      storage_path: path,
      thumb_url:    thumbUrl,
      full_url:     fullUrl,
      size_bytes:   file.size,
      position:     position,
    })
    .select()
    .single();

  if (dbError) throw dbError;

  return data;
}

/**
 * Upload em lote com controle de progresso por arquivo
 *
 * @param {FileList} files
 * @param {string}   galleryId
 * @param {function} onFileProgress(filename, percent)
 * @param {function} onFileDone(filename, photoData)
 * @param {function} onFileError(filename, error)
 */
async function photosUploadBatch(files, galleryId, { onFileProgress, onFileDone, onFileError } = {}) {
  const fileArray = Array.from(files);
  const results   = [];

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    try {
      onFileProgress?.(file.name, 10);
      const photo = await photoUpload(file, galleryId, i);
      onFileProgress?.(file.name, 100);
      onFileDone?.(file.name, photo);
      results.push({ ok: true, photo });
    } catch (err) {
      onFileError?.(file.name, err);
      results.push({ ok: false, error: err, filename: file.name });
    }
  }

  return results;
}

/**
 * Deletar foto (storage + banco)
 */
async function photoDelete(photoId, storagePath) {
  const sb = getSupabase();

  // Remove do storage
  const { error: storageError } = await sb.storage
    .from(STORAGE_BUCKET)
    .remove([storagePath]);

  if (storageError) throw storageError;

  // Remove do banco
  const { error: dbError } = await sb
    .from('photos')
    .delete()
    .eq('id', photoId);

  if (dbError) throw dbError;
}

/**
 * Reordenar fotos de uma galeria
 * @param {Array<{id, position}>} updates
 */
async function photosReorder(updates) {
  const sb = getSupabase();
  const promises = updates.map(({ id, position }) =>
    sb.from('photos').update({ position }).eq('id', id)
  );
  await Promise.all(promises);
}


// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Gera o link público da galeria do cliente
 * Em produção: substitua pelo seu domínio real
 */
function getClientGalleryLink(slug) {
  const domain = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://eusouleandroribeiro.vercel.app'; // ← trocar pelo seu domínio
  return `${domain}/gallery/${slug}`;
}

/**
 * Formata bytes para exibição legível
 */
function formatBytes(bytes) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}


// ════════════════════════════════════════════════════════════
// EXPORTA PARA USO GLOBAL (sem bundler)
// ════════════════════════════════════════════════════════════
window.LRP = {
  // Auth
  authLogin,
  authLogout,
  authGetSession,
  // Galleries
  galleriesGetAll,
  galleryGetBySlug,
  galleryCreate,
  galleryUpdate,
  galleryDelete,
  // Photos
  photoUpload,
  photosUploadBatch,
  photoDelete,
  photosReorder,
  // Utils
  getClientGalleryLink,
  formatBytes,
};
