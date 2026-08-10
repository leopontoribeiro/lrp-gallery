#!/bin/bash
# ============================================================
# LRP Gallery — Vídeo do Grupo (duplo-clique)
# Arraste o vídeo final do evento pra esta janela. Converte pro formato
# padrão (mp4) e associa ao grupo escolhido.
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
echo "│   LRP Gallery — Vídeo do Grupo                │"
echo "└────────────────────────────────────────────┘"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org e tente de novo."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "❌ ffmpeg não encontrado. Instale com: brew install ffmpeg"
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi
if [ ! -f "$DIR/.env.upload" ]; then
  echo "❌ Arquivo de credenciais .env.upload não encontrado."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

echo "Arraste o arquivo de vídeo para esta janela e tecle Enter:"
read -r -e VIDEO
VIDEO="${VIDEO%\"}"; VIDEO="${VIDEO#\"}"; VIDEO="${VIDEO%\'}"; VIDEO="${VIDEO#\'}"
VIDEO="$(echo "$VIDEO" | sed 's/[[:space:]]*$//')"

if [ ! -f "$VIDEO" ]; then
  echo ""; echo "❌ Arquivo inválido: $VIDEO"
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

node "$DIR/video-upload.mjs" "$VIDEO"
STATUS=$?

echo ""
if [ $STATUS -eq 0 ]; then
  echo "✅ Pronto. Você pode fechar esta janela."
else
  echo "⚠️  Houve um problema (código $STATUS)."
fi
read -r -p "Pressione Enter para fechar."
