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
