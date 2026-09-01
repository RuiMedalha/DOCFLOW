# Plano consolidado das 6 melhorias — 3 modelos convergiram

**Fonte:** Gemini (REF_ANALYSIS_GEMINI.md), DeepSeek/Kimi K2.6 (REF_ANALYSIS_DEEPSEEK.md), GPT sol (REF_ANALYSIS_GPT.md) — todos analisaram o programa português (Dori Finance) + as tuas screenshots + dorifinance.com.

**Consenso dos 3 modelos:** as mesmas 6 prioridades, na mesma ordem. Priorização por consenso:

## 1. QR Read First (P0 — máxima prioridade)
- Dori lê o QR-AT como fonte oficial. Os 3 modelos concordam que o QR dá "certeza" dos dados fiscais.
- Implementação: ZXing (robusto em fotos) → parseAtQr (split dos campos A/B/G/H/N/O). O Gemini vision só complementa (nome fornecedor, IBAN, linhas).
- **Estado:** pane-202 (implementa ZXing + jimp), a testar ao vivo.

## 2. Approval Flow (P1)
- Os 3 modelos: barra de ação no detalhe com botão "Aprovar" + estado do documento (PENDING → APPROVED).
- GPT sol agrupa com QR-first como "P0 — reduzir risco fiscal antes de aumentar superfície de UI".
- **Estado:** a implementar. Aproveitar o que já temos no backend (`approved` field, `onApprove` no detail).

## 3. Product Line Display (P1)
- Tabela interativa com descrição, qtd, preço, IVA por linha.
- Já extraímos `lineItems` para `metadata.extraction` (pane-146). Falta **mostrar** + opcionalmente **gravar em DocumentItem** (já existe a tabela).
- **Estado:** a implementar.

## 4. Supplier Sheet Link (P1)
- Link do documento → ficha do fornecedor com histórico de faturas + produtos.
- Party já é criado (auto-resolve do pane-154). Falta o ecrã + a navegação.
- GPT sol: "fecha o ciclo documento → entidade → contabilidade" — é o que dá o ciclo completo ao utilizador.
- **Estado:** a implementar.

## 5. Image Orientation (P1/P2)
- Corrigir EXIF orientation ao mostrar/guardar (fotos aparecem deitadas).
- Pane-202 (já toca nisso).
- **Estado:** pane-202 (implementa).

## 6. Document Naming (P2)
- Nome semântico em vez de "image.jpg" — ex: `Fornecedor_Data_NrDoc.pdf`.
- GPT sol: "encontrabilidade sem mexer no original".
- **Estado:** a implementar.

## Nota do Opus 5 (Kimi K2.6)
Listou também o que **NÃO** copiar do Dori (ex: não inchar com features enterprise que não servimos). Vou respeitar.

## Sequência de entrega (consenso)
**Onda 1 (P0+P1 — agora):**
- #1 QR primeiro (pane-202 a finalizar)
- #5 Orientação (pane-202, no mesmo worker)
- #2 Fluxo de aprovação
- #3 Linhas de produtos (mostrar)
- #4 Ficha de fornecedor

**Onda 2 (P2 — depois):**
- #6 Nome do documento

## Estado dos workers
- pane-202 (Opus 5): 🔧 QR + orientação (a testar)
- 4 análises (Gemini ✅, DeepSeek ✅, GPT ✅, Kimi K3 ainda sem ficheiro)
