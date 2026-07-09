#!/bin/bash
# ============================================================
# Publicador de 1 clique — LRP Gallery
# Sincroniza os arquivos do site para a pasta PUBLICAR (sem lixo/segredos)
# e publica no Cloudflare Pages. Basta dar 2 cliques neste arquivo.
# ============================================================
cd "$(dirname "$0")" || { echo "Nao achei a pasta do projeto."; read; exit 1; }

echo "==> 1/2 Preparando arquivos do site (pasta PUBLICAR)..."
mkdir -p PUBLICAR
rsync -a --delete \
  --exclude 'node_modules' --exclude '.git' --exclude '.wrangler' \
  --exclude 'r2-signed-worker' --exclude '.github' --exclude '.claude' \
  --exclude 'uploads' --exclude 'PUBLICAR' \
  --exclude '*.md' --exclude '*.txt' --exclude '*.sql' --exclude '*.sh' \
  --exclude '.env*' --exclude 'SIGNING_SECRET*' --exclude '.gitignore' \
  --exclude '*.mjs' --exclude '*.command' --exclude '*.ts' \
  --exclude 'supabase' --exclude 'r2-worker' --exclude '.vercel' --exclude 'vercel.json' \
  ./ PUBLICAR/ || { echo "Falha ao preparar arquivos."; read; exit 1; }

echo "==> 2/2 Publicando no Cloudflare Pages..."
cd PUBLICAR || { echo "Sem pasta PUBLICAR."; read; exit 1; }
npx wrangler pages deploy . --project-name=lrp-gallery --commit-dirty=true

echo ""
echo "==> Pronto. Se apareceu 'Deployment complete' acima, o site foi publicado."
echo "Pressione ENTER para fechar."
read
