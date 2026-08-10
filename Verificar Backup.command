#!/bin/bash
# ============================================================
# LRP Gallery — Verificar Backup (duplo-clique)
# Baixa o backup mais recente do R2, confere integridade e compara
# com o banco atual. NÃO escreve nada — só relatório.
# Para restaurar de fato, use o comando que ele sugere no fim.
# ============================================================
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
cd -P "$(dirname "$SOURCE")" || { echo "Não achei a pasta do projeto."; read; exit 1; }

clear
if [ ! -f .env.upload ]; then
  echo "Falta o arquivo .env.upload (SUPABASE_URL e SUPABASE_SERVICE_KEY)."
  read -p "Pressione ENTER para fechar."; exit 1
fi
set -a; source .env.upload; set +a

node restore-backup.mjs "$@"

echo ""
read -p "Pressione ENTER para fechar."
