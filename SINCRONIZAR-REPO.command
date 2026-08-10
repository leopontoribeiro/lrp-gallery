#!/bin/bash
# ============================================================
# Sincroniza o repositório com o que está em produção.
#
# Por que isso importa: o repo estava com 17 arquivos modificados e 25 nunca
# versionados. Quem lê o repo (você, eu, ou qualquer ferramenta) via um
# retrato errado do sistema — foi a causa de três erros seguidos.
#
# O .gitignore já bloqueia segredos (SIGNING_SECRET*.txt, .env, *.local.txt)
# e as pastas de build (PUBLICAR/, node_modules/, .wrangler/).
# Dois cliques neste arquivo.
# ============================================================
cd "$(dirname "$0")" || { echo "Nao achei a pasta do projeto."; read; exit 1; }

echo "==> 1/5 Destravando o git (lock de sessao anterior)..."
rm -f .git/index.lock .git/HEAD.lock 2>/dev/null
echo "    ok"

echo
echo "==> 2/5 Conferindo que nenhum segredo vai entrar..."
VAZAMENTO=$(git status --porcelain | awk '{print $NF}' | grep -iE "SIGNING_SECRET|\.env$|\.env\.|\.local\.txt|^PUBLICAR/" )
if [ -n "$VAZAMENTO" ]; then
  echo "    PAROU. Estes arquivos parecem sensiveis e nao deveriam ser versionados:"
  echo "$VAZAMENTO"
  echo "    Confira o .gitignore antes de continuar."
  read; exit 1
fi
echo "    ok - nenhum segredo na lista"

echo
echo "==> 3/5 Arquivos que serao versionados:"
git add -A
git status --short | head -60
TOTAL=$(git status --porcelain | wc -l | tr -d ' ')
echo "    total: $TOTAL arquivo(s)"

echo
echo "==> 4/5 Gravando o commit..."
git commit -q -m "chore: sincroniza o repositorio com a producao

Alinha o repo ao que esta no ar. Ate agora o repo mostrava um retrato
desatualizado do sistema, o que levou a correcoes baseadas em codigo que
nao era o de producao.

Inclui as correcoes desta rodada:
- senha da galeria validada no servidor (migracoes 34 e 37)
- consentimento LGPD gravado com IP e user-agent (migracao 38)
- acesso anonimo as tabelas fechado (migracao 36)
- capa do preview do WhatsApp em JPEG reduzido
- ZIP classico (macOS) com fatiamento automatico, sem limite de tamanho
- recuperacao de compra por e-mail
- marca d'agua a partir do derivado de 1600px gerado no upload
- falhas de carregamento visiveis em vez de pagina em branco" \
  && echo "    commit criado" \
  || echo "    nada novo para commitar"

echo
echo "==> 5/5 Enviando para o GitHub..."
if git push origin main 2>&1; then
  echo "    enviado"
else
  echo "    NAO enviou. Provavelmente falta autenticacao do GitHub nesta maquina."
  echo "    O commit local foi criado do mesmo jeito — nada foi perdido."
fi

echo
echo "==> Pronto. Ultimos commits:"
git log --oneline -3
echo
echo "Pressione ENTER para fechar."
read
