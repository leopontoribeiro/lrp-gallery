# 📋 ADMIN ACTIONS - Resumo das Funcionalidades

**Aplicável a**: Galerias Individuais + Grupos de Galerias

---

## 🎬 **6 AÇÕES NO MENU [⋮] DE CADA ITEM**

### 1️⃣ [QR] Gerar QR Code
```
Ação: Gerar QR code do item
Resultado: 
  - Modal com QR code
  - Opção de download
  - Opção de copy link

Técnica:
  - Grupo: /gallery/group/{uuid}
  - Galeria: /gallery/share/{token}
  - Usar QR.js ou QRServer API
  - Não persistir (gerar on-demand)
```

**Workflow:**
```
[QR] → Modal QR Code
      ├─ [Download PNG] 
      ├─ [Copy URL]
      └─ [Copy Link]
```

---

### 2️⃣ [📤] Compartilhamento (Toggle)
```
Ação: Ativar/Desativar compartilhamento
Status Atual: ☑ Ativo | ☐ Desativo

Funcionalidade:
  - Ativo: Link funciona, cliente acessa fotos
  - Desativo: Link inativo, cliente vê "Acesso negado"
  
Backend:
  - Patch sharing_enabled flag na BD
  - Se desativar: Invalidar share_tokens
  - Se ativar: Gerar novo share_token se não existir
```

**Workflow:**
```
[📤] Compartilhamento
    ├─ ☑ Ativo → [Desativar]
    └─ ☐ Desativo → [Ativar]
```

---

### 3️⃣ [📸] Mudar Capa
```
Ação: Trocar imagem de capa
Current: Exibir capa atual em thumbnail

Funcionalidade:
  - File picker (drag & drop ou click)
  - Validação: max 5MB, JPEG/PNG
  - Preview antes de salvar
  - SHA-256 hash para deduplicação
  - Delete capa anterior
  - Update com nova URL
```

**Workflow:**
```
[📸] Mudar Capa
    ├─ Upload nova imagem
    ├─ Preview
    ├─ [Confirmar] ou [Cancelar]
    └─ ✅ Capa atualizada
```

---

### 4️⃣ [⬇] Baixar Tudo (ZIP)
```
Ação: Baixar TODAS as fotos em ZIP
Escopo:
  - Grupo: Todas as fotos de todas as galerias filhas
  - Galeria: Todas as fotos da galeria

Resultado:
  - Arquivo ZIP gerado
  - Download automático
  - Estrutura: /evento/foto1.jpg, /evento/foto2.jpg, ...
  
Limite: 
  - Max 500MB (ou configurável)
  - Se > 500MB: Background job
```

**Workflow:**
```
[⬇] Baixar Tudo (ZIP)
    ├─ Validar tamanho
    ├─ Gerar ZIP em background
    ├─ Link de download
    ├─ [Download] 
    └─ Expira em 24h
```

---

### 5️⃣ [⭐] Baixar Favoritas (ZIP)
```
Ação: Baixar APENAS fotos marcadas como favoritas
Escopo:
  - Grupo: Favoritas de todas as galerias filhas
  - Galeria: Favoritas da galeria

Query: WHERE is_favorite = true

Resultado:
  - Arquivo ZIP (só favoritas)
  - Se 0 favoritas: "Nenhuma foto marcada como favorita"
```

**Workflow:**
```
[⭐] Baixar Favoritas (ZIP)
    ├─ Validar se tem favoritas
    ├─ Se 0 → "Nenhuma favorita"
    ├─ Se > 0 → Gerar ZIP
    ├─ [Download]
    └─ Expira em 24h
```

---

### 6️⃣ [🗑] Apagar Galeria/Grupo
```
Ação: Deletar item (soft delete por default)
Confirmação: 2 passos
  1. Clique: [🗑] Apagar
  2. Popup: "Tem certeza? Essa ação não pode ser revertida"

Soft Delete (default):
  - Marcar deleted_at = now()
  - Marcar deleted_by = auth.uid()
  - Manter fotos em storage (recuperável)
  - Share links desativam

Hard Delete (permanente):
  - Deletar shares
  - Deletar fotos do storage
  - Deletar da BD
  - NÃO reverter

Query: ?permanent=true (para hard delete)
```

**Workflow:**
```
[🗑] Apagar
    ├─ Clique 1: [🗑]
    ├─ Popup: "Confirmar?"
    ├─ Clique 2: [Apagar]
    └─ Item deletado (soft delete)
    
Se quer deletar permanente:
    └─ Clique [Apagar] + Hold Ctrl
       ou opção avançada [Deletar Permanentemente]
```

---

## 📊 **MATRIZ DE AÇÕES**

| Ação | Grupo | Galeria | Escopo |
|------|-------|---------|--------|
| [QR] Gerar | ✅ | ✅ | Link do item |
| [📤] Toggle | ✅ | ✅ | Share status |
| [📸] Mudar Capa | ✅ | ✅ | Nova imagem |
| [⬇] Baixar Tudo | ✅ Todas | ✅ Galeria | ZIP com fotos |
| [⭐] Favoritas | ✅ Todas | ✅ Galeria | ZIP favoritas |
| [🗑] Apagar | ✅ | ✅ | Soft delete |

---

## 🎨 **UI MOCKUP**

```
┌──────────────────────────────────────────────────┐
│ Leandro Rosadas - Eventos JUL/26                 │
│ [Capa Preview 200x120] (24 fotos) [⋮]            │
│                                                   │
│ Ao clicar [⋮]:                                   │
│ ┌─────────────────────────────────┐              │
│ │ [QR] Gerar QR Code              │              │
│ │ [📤] Compartilhamento (ativo)   │              │
│ │ [📸] Mudar Capa                 │              │
│ │ [⬇] Baixar Tudo (24 fotos)     │              │
│ │ [⭐] Baixar Favoritas (8)        │              │
│ │ [🗑] Apagar Grupo               │              │
│ └─────────────────────────────────┘              │
│                                                   │
│ Galerias dentro do grupo:                        │
│ ├─ Dia 1 - 01/07 (24 fotos) [⋮]                 │
│ │  ┌──────────────────────┐                      │
│ │  │ [QR] ...             │                      │
│ │  │ [📤] ...             │                      │
│ │  │ [🗑] ...             │                      │
│ │  └──────────────────────┘                      │
│ ├─ Dia 2 - 02/07 (18 fotos) [⋮]                 │
│ └─ Dia 3 - 03/07 (12 fotos) [⋮]                 │
└──────────────────────────────────────────────────┘
```

---

## 💾 **STORAGE & PERFORMANCE**

### ZIP Generation
```
Sync (< 100MB):
  - Gerar em memória
  - Retornar link direto
  - Válido por 24h

Async (> 100MB):
  - Queue job (Bull, Celery, etc)
  - Email quando pronto
  - Válido por 48h
```

### Capa Images
```
Storage: R2 / S3
Path: /covers/{gallery_id}.jpg
      /covers/{group_id}.jpg

Deduplicação:
  - SHA-256 hash
  - Se já existe com mesmo hash → reuse URL
  - Delete old → upload new
```

---

## 🔒 **SEGURANÇA**

### RLS & Ownership
```
- Owner pode fazer todas as ações
- Participant pode:
  ✅ Ver item (se compartilhado)
  ✅ Download fotos
  ❌ Mudar capa
  ❌ Toggle compartilhamento
  ❌ Apagar
```

### Rate Limiting
```
- Download ZIP: 1 a cada 5 min
- Mudar Capa: 1 a cada 10 min
- Apagar: 1 a cada 30 min
- Gerar QR: Unlimited (no-cost)
```

---

## 📈 **ROADMAP DE IMPLEMENTAÇÃO**

| Sprint | O quê |
|--------|-------|
| 1 | [QR] + [🗑] Apagar |
| 2 | [📤] Toggle Compartilhamento |
| 3 | [📸] Mudar Capa |
| 4 | [⬇] Baixar Tudo + [⭐] Favoritas |
| 5 | Testes + Polish |

---

**Status**: ✅ Pronto para desenvolvimento  
**Próximo**: Iniciar Sprint 1 (QR + Delete)
