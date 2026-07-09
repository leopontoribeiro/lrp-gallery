# 📋 TASK #17: Deploy Privacy Policy Page

## Status: ⏳ Em Execução

Instruções para colocar `privacy-policy-page.html` em produção.

---

## 📍 URL Alvo

```
www.souleandroribeiro.com.br/gallery/privacidade
```

---

## 🚀 Opção 1: Hospedagem Direta (Recomendado)

### A. Via FTP / SFTP

**Arquivo:** `privacy-policy-page.html` (na pasta `/Users/eusouleandroribeiro/lrp-gallery/`)

**Passos:**

1. Abra seu cliente FTP (Cyberduck, FileZilla, WinSCP, etc)
2. Conecte ao seu servidor
3. Navegue até: `/public_html/gallery/` (ou similar)
4. Crie pasta: `privacidade/` (se não existir)
5. Faça upload de `privacy-policy-page.html`
6. Renomeie para `index.html` dentro da pasta `privacidade/`

**Resultado:** `www.souleandroribeiro.com.br/gallery/privacidade/index.html`

Ou simplesmente upload direto como `privacidade.html`:

**Resultado:** `www.souleandroribeiro.com.br/gallery/privacidade.html`

---

### B. Via Git Push (se estiver usando vercel/netlify)

**Se seu site está em Vercel/Netlify:**

```bash
# 1. Copie o arquivo para o diretório public/
cp privacy-policy-page.html ./public/gallery/privacidade.html

# 2. Faça commit
git add public/gallery/privacidade.html
git commit -m "chore: add privacy policy page"

# 3. Push
git push origin main

# 4. Vercel/Netlify automaticamente redeploy
# URL fica pronta em segundos
```

---

## 🌐 Opção 2: Cloudflare Workers (Avançado)

Se quiser servir via Cloudflare Workers:

```javascript
// wrangler.toml
[env.production]
vars = { PRIVACY_PAGE_URL = "https://www.souleandroribeiro.com.br/gallery/privacidade" }
```

```javascript
// src/index.js
export default {
  async fetch(request, env) {
    if (request.url.includes('/gallery/privacidade')) {
      return new Response(PRIVACY_PAGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return fetch(request);
  }
};
```

---

## 📱 Verificação

Após fazer upload, teste:

### Checklist

- [ ] Página carrega em `www.souleandroribeiro.com.br/gallery/privacidade`
- [ ] Header com gradient aparece
- [ ] Contato banner está visível (email, telefone, horário)
- [ ] Links internos funcionam (atalhos de seção)
- [ ] Formulário de contato está funcional
- [ ] Mobile responsivo (abra em celular)
- [ ] FAQ expandível funciona
- [ ] Meta tags (title, description) aparecem corretamente
- [ ] Página aparece em Google (SEO)

---

## 🔗 Validar Links

Após deploy, teste manualmente:

```
Email: souleandroribeiro@gmail.com ✓
Telefone: +55 21 98326-7661 ✓
Portal: www.souleandroribeiro.com.br/gallery/privacidade ✓
Horário: Seg-Sex, 9h-18h ✓
Formulário de contato: enviando dados ✓
```

---

## 📊 SEO & Meta Tags

O arquivo já contém:

```html
<title>Política de Privacidade e LGPD - LRP Gallery</title>
<meta name="description" content="Conheça nossa política de privacidade, direitos LGPD e como protegemos seus dados biométricos.">
<meta property="og:title" content="Política de Privacidade - LRP Gallery">
<meta property="og:description" content="Informações sobre tratamento de dados e direitos LGPD">
```

---

## 🔄 Próximas Ações

### Depois de Deploy:

1. **Integrar no gallery.html**
   - Link no footer: "Política de Privacidade"
   - Link no admin: "Ver Política"

2. **Integrar no admin.html**
   - Atalho: "Ver Privacidade Online"

3. **Comunicar aos usuários**
   - Email: "Conheça nossa política de privacidade"
   - Modal no gallery: "Leia nossa política"

---

## 🎯 Checklist Final

- [ ] Arquivo enviado para servidor
- [ ] URL acessível
- [ ] Página renderiza corretamente
- [ ] Links funcionam
- [ ] Mobile responsivo
- [ ] Google indexou (Search Console)
- [ ] Links adicionados no gallery.html
- [ ] Links adicionados no admin.html

---

## 📞 Contato para Suporte

Se tiver dúvidas sobre o deploy:

1. **Hospedagem compartilhada (cPanel)?** → Use FTP (Opção 1A)
2. **Vercel/Netlify?** → Use Git Push (Opção 1B)
3. **Cloudflare?** → Use Workers (Opção 2)
4. **Outro servidor?** → Copie arquivo para pasta pública via SCP/SSH

---

**Status:** Pronto para deploy  
**Arquivo:** `/Users/eusouleandroribeiro/lrp-gallery/privacy-policy-page.html`  
**Tamanho:** ~43KB (inclui CSS inline)
