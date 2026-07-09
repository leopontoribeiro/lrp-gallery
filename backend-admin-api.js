// ============================================================
// BACKEND API - Admin Gallery Actions
// Node.js / Express endpoints
// ============================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const JSZip = require('jszip');
const router = express.Router();

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// POST /admin-api/download - Baixar fotos em ZIP
// ============================================================
router.post('/admin-api/download', async (req, res) => {
  try {
    const { type, id, favorites } = req.body;
    const user = req.user; // Middleware de auth

    if (!type || !id) {
      return res.status(400).json({ error: 'Missing type or id' });
    }

    // Validar ownership
    const table = type === 'group' ? 'gallery_groups' : 'galleries';
    const { data: item, error: fetchError } = await supabase
      .from(table)
      .select('owner_id')
      .eq('id', id)
      .single();

    if (fetchError || item.owner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Obter fotos
    let query = supabase.from('photos').select('*');

    if (type === 'group') {
      // Todas as fotos das galerias do grupo
      query = query.in('gallery_id',
        (await supabase
          .from('galleries')
          .select('id')
          .eq('gallery_group_id', id)).data.map(g => g.id)
      );
    } else {
      // Fotos da galeria específica
      query = query.eq('gallery_id', id);
    }

    if (favorites) {
      query = query.eq('is_favorite', true);
    }

    query = query.eq('deleted_at', null);

    const { data: photos, error: photosError } = await query;

    if (photosError) throw photosError;

    if (photos.length === 0) {
      return res.status(400).json({ error: 'No photos to download' });
    }

    // Criar ZIP
    const zip = new JSZip();
    let totalSize = 0;

    for (const photo of photos) {
      try {
        const response = await fetch(photo.url);
        const buffer = await response.buffer();
        zip.file(photo.filename || `photo-${photo.id}.jpg`, buffer);
        totalSize += buffer.length;
      } catch (err) {
        console.error(`Error downloading ${photo.id}:`, err);
      }
    }

    // Gerar arquivo
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const fileName = `${type}-${id}-${favorites ? 'favoritas' : 'fotos'}-${Date.now()}.zip`;

    // Upload temporário
    const { error: uploadError } = await supabase
      .storage
      .from('temp-downloads')
      .upload(fileName, zipBuffer);

    if (uploadError) throw uploadError;

    // Gerar URL pública
    const { data: publicUrl } = supabase
      .storage
      .from('temp-downloads')
      .getPublicUrl(fileName);

    // Log de download
    await supabase.from('download_history').insert({
      [type === 'group' ? 'gallery_group_id' : 'gallery_id']: id,
      user_id: user.id,
      download_type: favorites ? 'favorites' : 'all',
      file_size_bytes: totalSize,
      total_photos: photos.length
    });

    res.json({
      download_url: publicUrl.publicUrl,
      file_size_mb: (totalSize / 1024 / 1024).toFixed(2),
      total_photos: photos.length,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PATCH /admin-api/gallery/{id}/sharing - Toggle compartilhamento
// ============================================================
router.patch('/admin-api/gallery/:id/sharing', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Verificar ownership
    const { data: gallery } = await supabase
      .from('galleries')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (gallery.owner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Obter status atual
    const { data: current } = await supabase
      .from('galleries')
      .select('sharing_enabled')
      .eq('id', id)
      .single();

    const newStatus = !current.sharing_enabled;

    // Atualizar
    const { error } = await supabase
      .from('galleries')
      .update({
        sharing_enabled: newStatus,
        updated_at: new Date()
      })
      .eq('id', id);

    if (error) throw error;

    // Log
    await supabase.from('admin_action_logs').insert({
      admin_id: user.id,
      action_type: 'toggle_share',
      target_type: 'gallery',
      target_id: id,
      details: { enabled: newStatus }
    });

    res.json({ sharing_enabled: newStatus });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PATCH /admin-api/group/{id}/sharing - Toggle grupo
// ============================================================
router.patch('/admin-api/group/:id/sharing', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Verificar ownership
    const { data: group } = await supabase
      .from('gallery_groups')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (group.owner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Obter status atual
    const { data: current } = await supabase
      .from('gallery_groups')
      .select('sharing_enabled')
      .eq('id', id)
      .single();

    const newStatus = !current.sharing_enabled;

    // Atualizar
    const { error } = await supabase
      .from('gallery_groups')
      .update({
        sharing_enabled: newStatus,
        updated_at: new Date()
      })
      .eq('id', id);

    if (error) throw error;

    // Log
    await supabase.from('admin_action_logs').insert({
      admin_id: user.id,
      action_type: 'toggle_share',
      target_type: 'group',
      target_id: id,
      details: { enabled: newStatus }
    });

    res.json({ sharing_enabled: newStatus });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /admin-api/gallery/{id}/cover - Mudar capa
// ============================================================
router.post('/admin-api/gallery/:id/cover', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const file = req.files.cover_image;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validar
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 5MB)' });
    }

    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // Verificar ownership
    const { data: gallery } = await supabase
      .from('galleries')
      .select('owner_id, cover_image_url')
      .eq('id', id)
      .single();

    if (gallery.owner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Upload
    const filePath = `covers/gallery/${id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase
      .storage
      .from('gallery-covers')
      .upload(filePath, file.data);

    if (uploadError) throw uploadError;

    // Delete old if exists
    if (gallery.cover_image_url) {
      const oldPath = gallery.cover_image_url.split('/').pop();
      await supabase
        .storage
        .from('gallery-covers')
        .remove([oldPath]);
    }

    // Get public URL
    const { data: publicUrl } = supabase
      .storage
      .from('gallery-covers')
      .getPublicUrl(filePath);

    // Update DB
    const { error: updateError } = await supabase
      .from('galleries')
      .update({
        cover_image_url: publicUrl.publicUrl,
        updated_at: new Date()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Log
    await supabase.from('admin_action_logs').insert({
      admin_id: user.id,
      action_type: 'change_cover',
      target_type: 'gallery',
      target_id: id
    });

    res.json({ cover_url: publicUrl.publicUrl });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DELETE /admin-api/gallery/{id} - Apagar (soft delete)
// ============================================================
router.delete('/admin-api/gallery/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Verificar ownership
    const { data: gallery } = await supabase
      .from('galleries')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (gallery.owner_id !== user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Soft delete
    const { error: deleteError } = await supabase
      .from('galleries')
      .update({
        deleted_at: new Date(),
        deleted_by: user.id
      })
      .eq('id', id);

    if (deleteError) throw deleteError;

    // Desativar shares
    await supabase
      .from('share_links')
      .update({ active: false })
      .eq('gallery_id', id);

    // Log
    await supabase.from('admin_action_logs').insert({
      admin_id: user.id,
      action_type: 'delete',
      target_type: 'gallery',
      target_id: id
    });

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
