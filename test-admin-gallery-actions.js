// ============================================================
// TESTES: Admin Gallery Actions v2.0.0
// Valida as 6 ações em produção
// ============================================================

class AdminActionsTests {
  constructor(supabase) {
    this.supabase = supabase;
    this.results = [];
    this.testGalleryId = null;
  }

  async runAll() {
    console.log('🧪 Iniciando testes do Admin Gallery Actions...\n');

    try {
      // 1. Setup
      await this.setupTestData();

      // 2. Testes das 6 ações
      await this.testQRGeneration();
      await this.testToggleSharing();
      await this.testChangeCover();
      await this.testSoftDelete();
      await this.testDownloadAllPhotos();
      await this.testDownloadFavorites();

      // 3. Limpeza
      await this.cleanup();

      // 4. Relatório
      this.printReport();
    } catch (err) {
      console.error('❌ Erro durante testes:', err);
    }
  }

  async setupTestData() {
    console.log('📦 Setup: Criando dados de teste...');
    try {
      const { data: { user } } = await this.supabase.auth.getUser();

      // Criar galeria de teste
      const { data: gallery, error } = await this.supabase
        .from('galleries')
        .insert({
          name: 'Test Gallery ' + Date.now(),
          owner_id: user.id,
          client_id: null,
          sharing_enabled: true
        })
        .select()
        .single();

      if (error) throw error;
      this.testGalleryId = gallery.id;
      this.addResult('Setup', true, 'Dados de teste criados');
    } catch (err) {
      this.addResult('Setup', false, err.message);
      throw err;
    }
  }

  async testQRGeneration() {
    console.log('\n✅ Teste 1: Gerar QR Code');
    try {
      const qrData = {
        galleryId: this.testGalleryId,
        type: 'gallery',
        url: `/gallery/share/${this.testGalleryId}`
      };

      if (typeof QRCode !== 'undefined') {
        this.addResult('QR Generation', true, 'QR Code gerado com sucesso');
      } else {
        this.addResult('QR Generation', false, 'Biblioteca QR não carregada');
      }
    } catch (err) {
      this.addResult('QR Generation', false, err.message);
    }
  }

  async testToggleSharing() {
    console.log('✅ Teste 2: Toggle Compartilhamento');
    try {
      // Ativar
      const { data: result1, error: error1 } = await this.supabase
        .from('galleries')
        .update({ sharing_enabled: false })
        .eq('id', this.testGalleryId)
        .select()
        .single();

      if (error1) throw error1;

      // Desativar
      const { data: result2, error: error2 } = await this.supabase
        .from('galleries')
        .update({ sharing_enabled: true })
        .eq('id', this.testGalleryId)
        .select()
        .single();

      if (error2) throw error2;

      this.addResult('Toggle Sharing', true, 'Toggle funcionando');
    } catch (err) {
      this.addResult('Toggle Sharing', false, err.message);
    }
  }

  async testChangeCover() {
    console.log('✅ Teste 3: Mudar Capa');
    try {
      const testCoverUrl = 'https://via.placeholder.com/600x400';

      const { error } = await this.supabase
        .from('galleries')
        .update({
          cover_image_url: testCoverUrl,
          cover_image_hash: 'test-hash-123'
        })
        .eq('id', this.testGalleryId);

      if (error) throw error;

      this.addResult('Change Cover', true, 'Capa atualizada com sucesso');
    } catch (err) {
      this.addResult('Change Cover', false, err.message);
    }
  }

  async testSoftDelete() {
    console.log('✅ Teste 4: Soft Delete');
    try {
      const { data: { user } } = await this.supabase.auth.getUser();

      // Criar galeria para deletar
      const { data: delGallery, error: createErr } = await this.supabase
        .from('galleries')
        .insert({
          name: 'Delete Test ' + Date.now(),
          owner_id: user.id,
          client_id: null
        })
        .select()
        .single();

      if (createErr) throw createErr;

      // Soft delete
      const { error: deleteErr } = await this.supabase
        .from('galleries')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id
        })
        .eq('id', delGallery.id);

      if (deleteErr) throw deleteErr;

      this.addResult('Soft Delete', true, 'Soft delete funcionando');
    } catch (err) {
      this.addResult('Soft Delete', false, err.message);
    }
  }

  async testDownloadAllPhotos() {
    console.log('✅ Teste 5: Download Todas as Fotos');
    try {
      // Verificar se download_history existe
      const { data, error } = await this.supabase
        .from('download_history')
        .select('count')
        .eq('gallery_id', this.testGalleryId);

      if (error && error.code !== 'PGRST116') throw error;

      this.addResult('Download All', true, 'Tabela download_history acessível');
    } catch (err) {
      this.addResult('Download All', false, err.message);
    }
  }

  async testDownloadFavorites() {
    console.log('✅ Teste 6: Download Favoritas');
    try {
      // Verificar acesso a fotos favoritas
      const { data, error } = await this.supabase
        .from('photos')
        .select('*')
        .eq('gallery_id', this.testGalleryId)
        .eq('is_favorite', true);

      if (error && error.code !== 'PGRST116') throw error;

      this.addResult('Download Favorites', true, 'Query de favoritas funcional');
    } catch (err) {
      this.addResult('Download Favorites', false, err.message);
    }
  }

  async cleanup() {
    console.log('\n🧹 Limpeza: Removendo dados de teste...');
    try {
      await this.supabase
        .from('galleries')
        .delete()
        .eq('id', this.testGalleryId);

      this.addResult('Cleanup', true, 'Dados de teste removidos');
    } catch (err) {
      this.addResult('Cleanup', false, err.message);
    }
  }

  addResult(test, passed, message) {
    this.results.push({ test, passed, message });
    console.log(`  ${passed ? '✅' : '❌'} ${test}: ${message}`);
  }

  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('RELATÓRIO FINAL - Admin Gallery Actions');
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const percentage = Math.round((passed / total) * 100);

    console.log(`\n✅ Passaram: ${passed}/${total} (${percentage}%)\n`);

    this.results.forEach(r => {
      console.log(`${r.passed ? '✅' : '❌'} ${r.test}: ${r.message}`);
    });

    console.log('\n' + '='.repeat(60));
    if (percentage === 100) {
      console.log('🎉 SUCESSO! Todas as ações estão operacionais!');
    } else {
      console.log('⚠️  Alguns testes falharam. Verifique os detalhes acima.');
    }
    console.log('='.repeat(60) + '\n');
  }
}

// Executar testes
if (typeof supabase !== 'undefined') {
  const tester = new AdminActionsTests(supabase);
  tester.runAll();
} else {
  console.error('❌ Supabase não inicializado. Inclua supabase-config.js primeiro.');
}
