#!/bin/bash
# ============================================================
# Testa se a correção de senha (migração 34) está valendo no servidor.
# Dois cliques neste arquivo. Não altera nada — só faz consultas.
# ============================================================

K="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ymx4d2F4d3V6dGVodHhreWdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDQzMjMsImV4cCI6MjA5NjUyMDMyM30.0oscbNInwJzc2YN5eDYN76IBXvR0cTDbaLe4LDe0aKw"
U="https://vtblxwaxwuztehtxkygp.supabase.co/rest/v1/rpc/get_public_photos"
T="6653fe3fe5434809c3609c7860650dce"

echo "============================================"
echo "TESTE 1 — sobrou alguma função duplicada?"
echo "--------------------------------------------"
echo "Chamada com 3 parâmetros. Se a versão ANTIGA (sem senha) ainda"
echo "existisse junto com a nova, as duas aceitariam esta chamada e o"
echo "PostgREST responderia 'Could not choose the best candidate function'."
echo
R1=$(curl -s -X POST "$U" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" \
  -d "{\"p_token\":\"$T\",\"p_offset\":0,\"p_limit\":1}")
echo "$R1" | head -c 300
echo

if echo "$R1" | grep -q "best candidate"; then
  echo ">>> ATENÇÃO — as duas versões coexistem. A antiga precisa ser removida."
else
  echo ">>> OK — só existe uma versão da função."
fi

echo
echo "============================================"
echo "TESTE 2 — a função nova responde?"
echo "Esperado: [] ou uma foto (esta galeria não tem senha)"
echo "--------------------------------------------"
R2=$(curl -s -X POST "$U" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" \
  -d "{\"p_token\":\"$T\",\"p_offset\":0,\"p_limit\":1,\"p_pw\":null}")
echo "$R2" | head -c 300
echo

if echo "$R2" | grep -q "PGRST"; then
  echo ">>> ATENÇÃO — a função nova não existe. A migração 34 não rodou."
else
  echo ">>> OK — a função nova está no ar."
fi

echo
echo "============================================"
echo "Copie o resultado acima e mande para o Claude."
echo "Pressione ENTER para fechar."
read
