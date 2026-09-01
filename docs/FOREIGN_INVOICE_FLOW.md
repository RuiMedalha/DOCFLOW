# Fluxo de Faturas (nacionais + estrangeiras) — Desenho aprovado

Decisões do utilizador (2026-08-31). Este é o fluxo alvo para receber → ler → ligar fornecedor → arquivar.

## Pipeline completo

```
Documento entra (foto / PDF / scan / imagem)
   │
   ▼
1. loadDocumentText  → PDF: pdf-parse | imagem/foto: Gemini vision lê a imagem
   │
   ▼
2. Tem QR-AT (fatura PT)?
      SIM → extractFromQr (dados fiscais oficiais) + Gemini complementa (linhas, IBAN, fornecedor)  [pane-153]
      NÃO → Gemini vision + regex (fatura estrangeira ou PT sem QR)
   │
   ▼
3. É fatura?  → documentType do Gemini. Se não for fatura → arquiva como o tipo detetado (OUTRO, RECIBO, etc.)
   │
   ▼
4. FORNECEDOR (auto-link) — DECISÃO: "auto se confiança alta, senão sugerir"
      - Procura Party por VAT/NIF (e país).
      - Se existe → liga documento (partyId).
      - Se NÃO existe:
          · confiança IA > 0.8 E VAT/NIF válido → CRIA a ficha do fornecedor automaticamente
            (name, nif/vatId, country, iban) e liga.
          · caso contrário → deixa o documento com fornecedor SUGERIDO (status a rever),
            o utilizador confirma/cria a ficha antes de ligar.
   │
   ▼
5. PRODUTOS/LINHAS — DECISÃO: "só totais por agora"
      - Gravar total, base (netAmount), IVA (taxAmount), ivaBreakdown.
      - lineItems ficam no metadata.extraction (NÃO gravar em DocumentItem por agora).
      - (Futuro: gravar em DocumentItem quando quisermos conferência linha-a-linha.)
   │
   ▼
6. ARQUIVO / PASTAS — DECISÃO: "por tipo + período + fornecedor"
      Estrutura:  /Faturas/{Ano}/{Mês}/{Fornecedor}/
      - Nacional vs estrangeira separadas no topo:
          /Faturas/Nacionais/{Ano}/{Mês}/{Fornecedor}/
          /Faturas/Estrangeiras/{Ano}/{Mês}/{Fornecedor}/
      - "Estrangeira" = country != 'PT' (do VAT/IBAN detetado).
      - Alimenta suggestedFolder / finalFolder via FolderRulesEngine.
```

## O que já existe (não rebuild)
- Party: name, nif, iban, country(default PT), type. ✅
- Extração estrangeira: VAT VIES, IBAN multi-país MOD-97, moeda, locale. ✅ (pane-125)
- Gemini vision via OpenRouter (gemini-2.5-flash, primary). ✅ (pane-151)
- DocumentItem model existe (para o futuro passo 5 completo). ✅
- QR + Gemini merge. 🔧 (pane-153, em curso)

## O que falta implementar (esta frente)
1. **Auto-resolve fornecedor** no fim da extração: findParty(vat/nif+country) → link OU auto-create (conf>0.8 + VAT válido) OU flag "sugerido".
2. **Nacional vs Estrangeira**: derivar de country e alimentar a pasta.
3. **Estrutura de pastas** /Faturas/{Nacionais|Estrangeiras}/{Ano}/{Mês}/{Fornecedor}/ no FolderRulesEngine / suggestedFolder.
4. Garantir que "é fatura?" (documentType) encaminha não-faturas para o sítio certo.

## Notas
- Coordenar com pane-153 (QR+Gemini merge) — mesma zona de extraction.service.ts. Lançar ESTA frente só depois do 153 fechar.
- Confiança da IA: usar metadata.extraction.aiConfidence (o floor de auto-create é 0.8).

---

## AFINAÇÃO do arquivo (decisões 2026-08-31, parte 2)

### Fornecedor: recorrente vs ocasional
- **TODOS os fornecedores têm ficha (Party)** — sempre criada.
- **Só os RECORRENTES têm pasta própria** (/Fornecedores/{Nome}/...).
- **Ocasionais** (fatura avulsa, ex: restaurante de uma vez) → ficha existe, mas o documento arquiva-se no **Geral por CATEGORIA**, não numa pasta do fornecedor.
- Regra de "recorrente": marcar quando o fornecedor acumula histórico (ex: N faturas) ou flag manual `isRecurring` na ficha.

### Arquivo por CATEGORIA de despesa (crítico — IVA)
Motivo (utilizador): o IVA é diferente por tipo de despesa; é preciso separar em pastas por categoria para depois tratar a dedutibilidade do IVA segundo a lei (refeições e combustível têm regras de dedução específicas em PT).

Estrutura de pastas para despesas gerais/ocasionais:
```
/Despesas/{Categoria}/{Ano}/{Mês}/
   ex: /Despesas/Refeições/2026/08/
       /Despesas/Combustível/2026/08/
       /Despesas/Alojamento/2026/08/
       /Despesas/Deslocações/2026/08/
```
Fornecedores recorrentes mantêm a sua pasta:
```
/Fornecedores/{Nome}/{Ano}/{Mês}/
```
Faturas estrangeiras: prefixo /Estrangeiras/ ou flag country != PT (a confirmar na implementação).

### Categoria + análise de IVA — AUTOMÁTICO **e** MANUAL (ambos)
- **Automático:** Gemini classifica a categoria de despesa (suggestedCategory) E extrai a taxa/breakdown de IVA (ivaBreakdown). A categoria alimenta a pasta.
- **Manual:** o utilizador pode alterar a categoria e o tratamento de IVA na revisão do documento.
- Guardar, por categoria, a **taxa de IVA** e (futuro) a **regra de dedutibilidade** para o cálculo fiscal — as categorias com dedução limitada (refeições, combustível) ficam marcadas para tratamento correto no apuramento de IVA.

### Categorias de despesa iniciais (PT)
Refeições, Combustível, Alojamento, Deslocações/Viagens, Material de escritório, Serviços/FSE, Comunicações, Rendas, Outras. (Editáveis pelo utilizador.)

---

## Campos em falta na extração (teste real telemóvel, 2026-08-31)

Após teste com foto real (fatura Américo Alves), o Gemini leu supplier/NIF/cliente/ATCUD/total/IVA/datas/linhas MAS faltam:

1. **Descontos** (DECISÃO: de linha + global)
   - Adicionar `discount` por linha (já há campo em DocumentItem) E desconto global da fatura.
   - Extrair no prompt do Gemini + refletir no cálculo de base/total.
   - Schema: adicionar campo de desconto global ao Document (ou metadata).

2. **Datas** — docDate e dueDate JÁ vêm. Confirmar também:
   - data de pagamento efetivo (paidDate) quando aplicável — já existe paymentDueDate no schema.
   - Garantir que o prompt pede due date / prazo de pagamento explicitamente.

3. **Fornecedor recorrente** (o "printer" da ditação = fornecedor habitual vs ocasional)
   - Já existe party.isRecurring (pane-154). Falta MOSTRAR no documento/UI: se o fornecedor é recorrente (ficha+pasta própria) ou ocasional (Geral por categoria).
   - Superficiar isRecurring no detalhe do documento.

4. **IVA discriminado por taxa** (DECISÃO: por taxa)
   - Consolidar ivaBreakdown: por cada taxa (23%, 13%, 6%, isento) → base + valor de imposto.
   - Total de IVA dedutível/a pagar. É a base do apuramento de IVA.
   - O Gemini já lê vatRate por linha; falta AGREGAR por taxa e persistir ivaBreakdown (veio "n/a" no teste).

Prioridade: IVA discriminado (fiscal) + descontos (afeta totais) são os mais críticos.
Estes tocam extraction.service.ts + vision.service.ts (prompt) — lançar após panes 159/160 fecharem.
