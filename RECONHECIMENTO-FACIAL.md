# Reconhecimento facial na seleção — análise e plano

**É possível?** Sim. A pessoa tira uma selfie, o sistema extrai um "vetor facial"
(embedding) e compara com os rostos detectados nas fotos do evento, retornando as
que têm alta similaridade. É tecnologia madura. O que exige cuidado é **privacidade/LGPD**
(rosto é dado biométrico sensível) e **custo/precisão** em galerias grandes.

---

## Como funciona (visão geral)
1. **Indexação** (uma vez, ao subir o álbum): detectar rostos em cada foto e guardar
   um embedding por rosto (vetor de ~128–512 números) + a foto de origem.
2. **Busca** (cliente): selfie → 1 embedding → comparar com os embeddings do álbum
   (distância de cosseno) → devolver fotos acima de um limiar de similaridade.
3. Mostrar essas fotos já na tela de seleção ("as suas fotos").

---

## Duas arquiteturas

### A) No navegador (client-side) — `face-api.js` / `human`
- Detecção e embedding rodam no dispositivo do cliente; a selfie **nunca sai** do aparelho.
- Os embeddings do álbum são gerados no upload (Node + o mesmo modelo) e servidos como JSON.
- **Prós:** privacidade máxima (biometria não trafega), sem custo por imagem, sem terceiro.
- **Contras:** precisão menor com pouca luz/ângulos difíceis; baixar modelo (~6–15 MB) e
  comparar milhares de rostos pesa em celular fraco; indexar 1500 fotos leva minutos no upload.
- **Melhor para:** volume moderado, evento social, prioridade em privacidade e custo zero.

### B) Nuvem — AWS Rekognition (ou GCP/Azure equivalentes)
- API detecta/indexa rostos (`IndexFaces`) numa "coleção" e busca por selfie (`SearchFacesByImage`).
- **Prós:** alta precisão, escala fácil, pouco código.
- **Contras:** **envia biometria a um terceiro** (peso extra de LGPD), custo por imagem
  (~US$0,001/imagem indexada + por busca) e armazenamento de rostos; vendor lock-in.
- **Melhor para:** volume alto e exigência de precisão, com base jurídica bem tratada.

---

## LGPD (obrigatório antes de ligar)
Rosto = **dado pessoal sensível** (art. 5º, II). Implica:
- **Consentimento específico e destacado** de quem envia a selfie (checkbox claro, não pré-marcado),
  explicando finalidade (encontrar suas fotos), retenção e como apagar.
- **Minimização e retenção curta:** apagar a selfie e o embedding logo após a busca
  (ex.: sessão efêmera; não persistir a selfie).
- **Pessoas nas fotos que não são o solicitante:** a indexação processa rostos de terceiros.
  Recomenda-se aviso no álbum e base legal (legítimo interesse do contratante do evento),
  além de opção de remoção.
- Na arquitetura **A (client-side)** o risco cai muito: a biometria não trafega nem é armazenada
  em servidor — é a rota recomendada para começar.

---

## Custo/esforço (estimativa)
| Item | Client-side (A) | Nuvem (B) |
|---|---|---|
| Custo recorrente | ~0 | ~US$1–3 por 1000 fotos + buscas |
| Precisão | Boa | Muito boa |
| Privacidade | Alta | Média (terceiro) |
| Esforço de build | Médio-alto | Médio |
| Infra nova | Job de indexação no upload + JSON de embeddings | Conta AWS + coleção + credenciais |

---

## Recomendação
Começar pela **arquitetura A (client-side, `human`/`face-api.js`)**: privacidade por padrão,
custo zero, sem novo fornecedor — casa com o que o app já é (estático + R2 + Supabase).
Migrar para nuvem só se a precisão não bastar em eventos grandes.

## Plano em fases (quando decidir ir)
1. **Piloto (1 álbum):** indexar no `upload.mjs` (gera `faces.json` por galeria no R2);
   tela de "encontrar minhas fotos" com selfie + consentimento; comparação no navegador.
2. **Ajuste de limiar** com fotos reais (precisão x recall) e UX de "não encontramos, veja todas".
3. **Escala:** cachear embeddings, agrupar rostos ("aparece em N fotos"), opção de remoção.
4. **Governança:** texto de consentimento revisado, política de retenção, registro no álbum.

> Decisões abertas para quando formos implementar: (a) client-side vs nuvem definitivo;
> (b) texto/base legal do consentimento; (c) apagar selfie na hora vs manter durante a sessão.
