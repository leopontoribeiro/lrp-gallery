#!/bin/bash
# ============================================================
# Deploy: Gallery Groups Migration
# Executa a migration SQL no Supabase
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/migration-gallery-groups.sql"

echo "🚀 Gallery Groups - Database Migration"
echo "======================================"
echo ""

# Verificar se arquivo existe
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Arquivo não encontrado: $MIGRATION_FILE"
    exit 1
fi

echo "📝 Migration file: $MIGRATION_FILE"
echo "📊 Tamanho: $(wc -l < $MIGRATION_FILE) linhas"
echo ""

# Instruções de execução
echo "Para executar a migration, escolha uma opção:"
echo ""
echo "Opção 1: Supabase UI (Recomendado)"
echo "  1. Abra: https://supabase.com/dashboard/project/vtblxwaxwuztehtxkygp/sql"
echo "  2. Nova query"
echo "  3. Cole o SQL"
echo "  4. Clique 'Run'"
echo ""
echo "Opção 2: Via CLI"
echo "  $ supabase db push"
echo ""
echo "Opção 3: Copiar SQL para clipboard"
echo "  $ cat $MIGRATION_FILE | pbcopy  # macOS"
echo "  $ cat $MIGRATION_FILE | xclip -i -selection clipboard  # Linux"
echo ""

# Mostrar preview
echo "📋 Preview do SQL:"
echo "=================================================="
head -20 "$MIGRATION_FILE"
echo ""
echo "... (mais linhas)"
echo "=================================================="
echo ""

echo "✅ Script pronto!"
echo ""
echo "⏭️  Próximo passo:"
echo "   Execute a migration usando uma das opções acima"
