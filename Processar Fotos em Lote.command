#!/bin/bash
# ============================================================
# LRP Gallery — Processamento em Lote (duplo-clique)
# Converte até ~1500 fotos de tamanhos/formatos variados pra JPEG dentro
# de um teto de tamanho (1.2–2MB), renomeando em sequência.
# ============================================================

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
cd "$DIR" || { echo "Não foi possível acessar a pasta do projeto."; exit 1; }

clear
echo "┌────────────────────────────────────────────┐"
echo "│   LRP Gallery — Processamento em Lote        │"
echo "└────────────────────────────────────────────┘"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org e tente de novo."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

clean_path() {
  local p="$1"
  p="${p%\"}"; p="${p#\"}"; p="${p%\'}"; p="${p#\'}"
  echo "$p" | sed 's/[[:space:]]*$//'
}

echo "Arraste a pasta com as fotos originais para esta janela e tecle Enter:"
read -r -e FOLDER
FOLDER="$(clean_path "$FOLDER")"
if [ ! -d "$FOLDER" ]; then
  echo ""; echo "❌ Pasta inválida: $FOLDER"
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

echo ""
echo "Nome-base para as fotos (ex: Casamento Ana e João):"
read -r NAME
if [ -z "$NAME" ]; then
  echo ""; echo "❌ Nome não pode ficar vazio."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

echo ""
echo "Tamanho máximo por foto em MB (1.2 a 2, padrão 1.5):"
read -r MAXMB
MAXMB="${MAXMB:-1.5}"

echo ""
echo "Para onde vão as fotos processadas?"
echo "  1) Salvar numa pasta local"
echo "  2) Subir direto pra uma galeria nova"
read -r -p "Escolha (1 ou 2): " MODE

if [ "$MODE" = "2" ]; then
  if [ ! -f "$DIR/.env.upload" ]; then
    echo ""; echo "❌ Arquivo de credenciais .env.upload não encontrado (necessário pro modo galeria)."
    echo "   Crie-o a partir de .env.upload.example e cole sua chave service_role."
    echo ""; read -r -p "Pressione Enter para fechar."; exit 1
  fi
  set -a; . "$DIR/.env.upload"; set +a
  node "$DIR/bulk-process.mjs" "$FOLDER" --name "$NAME" --max-mb "$MAXMB" --gallery
else
  echo ""
  echo "Arraste (ou digite) a pasta de destino e tecle Enter:"
  read -r -e OUTFOLDER
  OUTFOLDER="$(clean_path "$OUTFOLDER")"
  if [ -z "$OUTFOLDER" ]; then
    echo ""; echo "❌ Pasta de destino não pode ficar vazia."
    echo ""; read -r -p "Pressione Enter para fechar."; exit 1
  fi
  node "$DIR/bulk-process.mjs" "$FOLDER" --name "$NAME" --max-mb "$MAXMB" --out "$OUTFOLDER"
fi
STATUS=$?

echo ""
if [ $STATUS -eq 0 ]; then
  echo "✅ Pronto. Você pode fechar esta janela."
else
  echo "⚠️  Houve um problema (código $STATUS)."
fi
read -r -p "Pressione Enter para fechar."
