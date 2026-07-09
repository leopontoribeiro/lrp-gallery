#!/bin/bash
# ============================================================
# LRP Gallery — Upload para Galeria (duplo-clique)
# Arraste uma pasta de fotos para a janela e tecle Enter.
# Cria uma galeria nova com o nome da pasta e envia tudo.
# ============================================================

# Vai para a pasta deste script (segue symlinks)
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
echo "│   LRP Gallery — Upload para Galeria          │"
echo "└────────────────────────────────────────────┘"
echo ""

# Node instalado?
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org e tente de novo."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

# Credenciais
if [ ! -f "$DIR/.env.upload" ]; then
  echo "❌ Arquivo de credenciais .env.upload não encontrado."
  echo "   Crie-o a partir de .env.upload.example e cole sua chave service_role."
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi
set -a; . "$DIR/.env.upload"; set +a

# Pasta de fotos: argumento (arquivo arrastado) ou pergunta
FOLDER="$1"
if [ -z "$FOLDER" ]; then
  echo "Arraste a pasta de fotos para esta janela e tecle Enter:"
  read -r -e FOLDER
fi
# Remove aspas e espaço final que o arrastar adiciona
FOLDER="${FOLDER%\"}"; FOLDER="${FOLDER#\"}"; FOLDER="${FOLDER%\'}"; FOLDER="${FOLDER#\'}"
FOLDER="$(echo "$FOLDER" | sed 's/[[:space:]]*$//')"

if [ ! -d "$FOLDER" ]; then
  echo ""; echo "❌ Pasta inválida: $FOLDER"
  echo ""; read -r -p "Pressione Enter para fechar."; exit 1
fi

node "$DIR/upload.mjs" "$FOLDER"
STATUS=$?

echo ""
if [ $STATUS -eq 0 ]; then
  echo "✅ Pronto. Você pode fechar esta janela."
else
  echo "⚠️  Houve um problema (código $STATUS)."
fi
read -r -p "Pressione Enter para fechar."
