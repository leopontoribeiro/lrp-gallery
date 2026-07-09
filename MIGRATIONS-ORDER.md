# 📋 MIGRAÇÕES SUPABASE - ORDEM E NOMES

**Status**: Pronto para executar  
**Versão**: v1.0.0  
**Tempo total**: ~5 min (executar tudo de uma vez)

---

## ⚡ EXECUÇÃO RÁPIDA (RECOMENDADO)

**Cole TUDO de uma vez** no Supabase SQL Editor:
```
Arquivo: migration-qr-codes-auth-monitoring.sql
Local: /lrp-gallery/migration-qr-codes-auth-monitoring.sql
Tempo: 2-3 minutos
Resultado: Tudo executado automaticamente
```

**Não precisa fazer em fases separadas.** O arquivo contém todas as 5 fases com dependências corretas.

---

## 📚 SE PREFERIR POR FASES (Separado)

Se quiser executar em múltiplas queries por segurança, a ordem é:

### **FASE 1: QR Codes (Deve ser 1º)**
**Nome**: `01-qr-codes-share-links.sql`  
**Dependências**: Nenhuma  
**Ordem**: PRIMEIRA  
**Duração**: 30 seg

```sql
-- Adicionar colunas à tabela share_links
ALTER TABLE IF EXISTS public.share_links 
ADD COLUMN IF NOT EXISTS qr_code_url text,
ADD COLUMN IF NOT EXISTS qr_code_generated_at timestamp;

-- Criar função para gerar QR code
CREATE OR REPLACE FUNCTION public.generate_qr_code_url(share_token text)
RETURNS text AS $$
BEGIN
  RETURN 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' || 
         encode(concat('/gallery/share/', share_token)::bytea, 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Atualizar links existentes
UPDATE public.share_links 
SET 
  qr_code_url = public.generate_qr_code_url(token),
  qr_code_generated_at = now()
WHERE qr_code_url IS NULL;

-- Criar trigger para novos links
CREATE OR REPLACE FUNCTION public.create_qr_code_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  NEW.qr_code_url := public.generate_qr_code_url(NEW.token);
  NEW.qr_code_generated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS share_links_qr_code ON public.share_links;
CREATE TRIGGER share_links_qr_code 
BEFORE INSERT ON public.share_links
FOR EACH ROW 
EXECUTE FUNCTION public.create_qr_code_on_insert();
```

---

### **FASE 2: Autenticação Admin + RLS (Deve ser 2º)**
**Nome**: `02-admin-auth-rls-policies.sql`  
**Dependências**: FASE 1  
**Ordem**: SEGUNDA  
**Duração**: 1 min

```sql
-- Adicionar owner_id aos clientes
ALTER TABLE IF EXISTS public.clients 
ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Adicionar updated_by tracking aos events
ALTER TABLE IF EXISTS public.events 
ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- RLS Policy: Clientes são privados por owner
DROP POLICY IF EXISTS "Public read clients" ON clients;
DROP POLICY IF EXISTS "Authenticated users can create clients" ON clients;
DROP POLICY IF EXISTS "Users can only see own clients" ON clients;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Admin pode ler seus próprios clientes
CREATE POLICY "Users can read own clients" ON clients
FOR SELECT USING (owner_id = auth.uid() OR owner_id IS NULL);

-- Admin pode inserir clientes
CREATE POLICY "Users can create clients" ON clients
FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Admin pode atualizar seus clientes
CREATE POLICY "Users can update own clients" ON clients
FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Admin pode deletar seus clientes
CREATE POLICY "Users can delete own clients" ON clients
FOR DELETE USING (owner_id = auth.uid());

-- RLS Policy: Eventos herdam permissão do cliente
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read events" ON events;

CREATE POLICY "Events readable by owner or public" ON events
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM clients c 
    WHERE c.id = events.client_id 
    AND (c.owner_id = auth.uid() OR c.owner_id IS NULL)
  )
);

CREATE POLICY "Users can modify own events" ON events
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM clients c 
    WHERE c.id = events.client_id 
    AND c.owner_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM clients c 
    WHERE c.id = events.client_id 
    AND c.owner_id = auth.uid()
  )
);

-- Share links: apenas owner do evento pode gerenciar
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public share links" ON share_links;

CREATE POLICY "Share links readable by owner" ON share_links
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM events e, clients c
    WHERE e.id = share_links.event_id
    AND c.id = e.client_id
    AND c.owner_id = auth.uid()
  ) OR true
);

CREATE POLICY "Only event owner can manage links" ON share_links
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM events e, clients c
    WHERE e.id = share_links.event_id
    AND c.id = e.client_id
    AND c.owner_id = auth.uid()
  )
);
```

---

### **FASE 3: Monitoring & Logging (Deve ser 3º)**
**Nome**: `03-monitoring-logging-tables.sql`  
**Dependências**: FASE 2  
**Ordem**: TERCEIRA  
**Duração**: 1 min

```sql
-- Tabela de error logs
CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  level text NOT NULL,
  message text NOT NULL,
  error_code text,
  context jsonb,
  user_id uuid REFERENCES auth.users(id),
  ip_address inet,
  user_agent text,
  created_at timestamp DEFAULT now(),
  resolved_at timestamp,
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_error_logs_level_created ON error_logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_unresolved ON error_logs(resolved_at) WHERE resolved_at IS NULL;

-- Tabela de performance metrics
CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint text NOT NULL,
  method text NOT NULL,
  response_time_ms integer NOT NULL,
  status_code integer,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_performance_endpoint_created ON performance_metrics(endpoint, created_at DESC);

-- Tabela de security events
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type text NOT NULL,
  severity text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  ip_address inet,
  details jsonb,
  is_resolved boolean DEFAULT false,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created ON security_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_unresolved ON security_events(is_resolved) WHERE NOT is_resolved;

-- Função para registrar erros
CREATE OR REPLACE FUNCTION public.log_error(
  p_level text,
  p_message text,
  p_error_code text,
  p_context jsonb DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  log_id uuid;
BEGIN
  INSERT INTO error_logs(level, message, error_code, context, user_id)
  VALUES (p_level, p_message, p_error_code, p_context, auth.uid())
  RETURNING id INTO log_id;
  
  IF p_level = 'error' THEN
    INSERT INTO security_events(event_type, severity, user_id, details)
    VALUES ('error_logged', 'medium', auth.uid(), jsonb_build_object(
      'error_code', p_error_code,
      'message', p_message
    ));
  END IF;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para registrar métricas de performance
CREATE OR REPLACE FUNCTION public.log_performance(
  p_endpoint text,
  p_method text,
  p_response_time_ms integer,
  p_status_code integer
)
RETURNS void AS $$
BEGIN
  INSERT INTO performance_metrics(endpoint, method, response_time_ms, status_code, user_id)
  VALUES (p_endpoint, p_method, p_response_time_ms, p_status_code, auth.uid());
  
  IF p_response_time_ms > 5000 THEN
    INSERT INTO security_events(event_type, severity, details)
    VALUES ('slow_response', 'low', jsonb_build_object(
      'endpoint', p_endpoint,
      'response_time_ms', p_response_time_ms
    ));
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### **FASE 4: Rate Limiting (Deve ser 4º)**
**Nome**: `04-rate-limiting.sql`  
**Dependências**: FASE 3  
**Ordem**: QUARTA  
**Duração**: 30 seg

```sql
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id),
  ip_address inet,
  endpoint text,
  request_count integer DEFAULT 1,
  window_start timestamp DEFAULT now(),
  window_end timestamp DEFAULT now() + interval '1 hour',
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_endpoint ON api_rate_limits(user_id, endpoint, window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON api_rate_limits(ip_address, endpoint, window_start);
```

---

### **FASE 5: Backup Tracking (Deve ser 5º)**
**Nome**: `05-backup-history.sql`  
**Dependências**: FASE 4  
**Ordem**: QUINTA  
**Duração**: 30 seg

```sql
CREATE TABLE IF NOT EXISTS public.backup_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_name text NOT NULL,
  backup_type text NOT NULL,
  status text NOT NULL,
  started_at timestamp,
  completed_at timestamp,
  size_bytes bigint,
  error_message text,
  test_restore_status text,
  test_restore_date timestamp,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);
CREATE INDEX IF NOT EXISTS idx_backup_history_created ON backup_history(created_at DESC);
```

---

## 📊 RESUMO

| # | Nome | Duração | Ordem | Status |
|---|------|---------|-------|--------|
| 1 | QR Codes | 30 seg | 1ª | ⏳ Pendente |
| 2 | Admin Auth + RLS | 1 min | 2ª | ⏳ Pendente |
| 3 | Monitoring + Logging | 1 min | 3ª | ⏳ Pendente |
| 4 | Rate Limiting | 30 seg | 4ª | ⏳ Pendente |
| 5 | Backup History | 30 seg | 5ª | ⏳ Pendente |

**TEMPO TOTAL**: 3-4 minutos

---

## ✅ PRÓXIMOS PASSOS

Depois das migrações:
1. ✓ Edge Function: security-headers
2. ✓ Sentry: Configurar projeto
3. ✓ Testes: Validar tudo

Ver: **QUICK-START-15MIN.txt**

