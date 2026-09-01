# Análise de referência: Dori Finance vs. DocFlow

**Âmbito.** Revisão visual de 37 capturas mobile de `app.dorifinance.com` (série `WhatsApp Image 2026-09-01 at 14.40.24`–`14.40.28 (8)`) e da página pública [dorifinance.com/en](https://www.dorifinance.com/en/), comparada com a implementação atual do detalhe DocFlow. É uma análise, não uma afirmação de comportamento em produção da Dori.

## Leitura da referência

- A Dori usa uma linguagem operacional muito clara: breadcrumb, título+frase de propósito, uma acção primária verde e cartões de resumo. Nos ecrãs de despesas/vendas há pesquisa, intervalo de datas, filtro, total/IVA e tabela com estado, nome, valor e data. O plano de contas a pagar torna urgente o atraso (cartão rosa, valor vermelho) e separa-o de totais normais.
- O onboarding transforma o objectivo em passos accionáveis: ligar InvoiceXpress, carregar despesas e ligar banco. As acções incluem contexto de segurança (só leitura, desligável) e os uploads têm e-mail dedicado copiável, drag-and-drop, limites e tipos aceites visíveis.
- A folha/modal é consistente: fundo desfocado, título, instrução curta, fechar, acção primária de largura total e cancelar. Vê-se em exportação e carga de faturas.
- As capturas entregues **não mostram uma fatura individual aberta**. Portanto não há evidência visual de layout de detalhe com imagem+campos, linhas de produto, ficha de fornecedor, botões de aprovação, rotação/zoom nem regra de nomenclatura da Dori. As recomendações abaixo para esses tópicos decorrem da lacuna do DocFlow e dos padrões observados, não de uma alegação de que a Dori os implementa.
- A página pública reforça o mesmo valor: ligação bancária, reconciliação e P&L em linguagem de resultado; diz também que a IA não toma decisões automáticas e requer supervisão humana. É uma boa direcção para a copy e estados de aprovação do DocFlow.

## Prioridades recomendadas

| Prioridade | Pedido | Melhoria concreta para o DocFlow | Ficheiros a alterar |
|---|---|---|---|
| P0 | 1. Ler QR primeiro | Tornar o QR-AT a primeira secção de decisão: no topo do painel, mostrar “QR lido / inválido / ausente”, confiança e os campos canónicos preenchidos pelo QR; só depois apresentar OCR editável, com divergências QR↔OCR destacadas. Impede aprovar campos de OCR antes de ver a fonte fiscal mais forte. | `apps/web/app/(dashboard)/documents/[id]/page.tsx`; `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`; `.../_components/qr-badge.tsx`; `apps/web/app/(dashboard)/documents/[id]/_lib/use-document-detail.ts`; `apps/api/src/modules/documents/documents.service.ts` |
| P0 | 2. Fluxo de aprovação | Substituir o único botão “Aprovar” por estados explícitos `NOVO → EM_REVISAO → APROVADO` (e `REJEITADO` com motivo), checklist de bloqueio: QR/extração, fornecedor, totais=linhas, IBAN e conta contabilística. Exigir confirmação numa folha/modal padrão e registar utilizador, data e motivo. Depois de aprovado, oferecer “Enviar/contabilizar” como próximo passo, não como acção ambígua. | `apps/web/app/(dashboard)/documents/[id]/page.tsx`; `.../_components/field-panel.tsx`; `.../_lib/use-document-detail.ts`; `apps/api/src/modules/documents/documents.controller.ts`; `apps/api/src/modules/documents/documents.service.ts`; `apps/api/prisma/schema.prisma` |
| P1 | 3. Produtos/linhas | Manter a tabela já existente, mas torná-la sempre encontrável: mostrar secção “Produtos/linhas (n)” mesmo vazia, resumo por IVA e diferença para total; permitir expandir uma linha para quantidade, preço, desconto, IVA e centro/categoria. Para mobile, usar cartões expansíveis em vez de depender de scroll horizontal. | `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`; `.../_lib/use-document-detail.ts`; `apps/api/prisma/schema.prisma`; `apps/api/src/modules/documents/documents.service.ts` |
| P1 | 4. Link para ficha do fornecedor | Converter “Fornecedor” num link/selector de entidade: se `partyId` existir, abrir `/parties/[id]`; se não existir, sugerir “Criar/associar fornecedor” com NIF como chave. No detalhe da ficha, incluir histórico de documentos, total, vencidos e IBAN/riscos — o modelo de cartões e contexto da Dori torna esta relação financeira escaneável. | `apps/web/app/(dashboard)/documents/[id]/page.tsx`; `.../_components/field-panel.tsx`; `apps/web/app/(dashboard)/parties/[id]/page.tsx`; `apps/web/app/(dashboard)/parties/_components/party-detail.tsx`; `apps/web/app/(dashboard)/parties/_components/use-parties.ts`; `apps/api/src/modules/documents/documents.service.ts` |
| P1 | 5. Orientação e zoom da imagem | Não converter silenciosamente a fotografia para a derivada PDF como única prévia. Exibir original e PDF como opções e adicionar controles acessíveis de rodar 90°/repor, zoom ±, ajustar à largura e abrir em ecrã inteiro; persistir só a preferência/transformação de visualização, nunca alterar o original. Isto é crucial para fotos de recibos em mobile. | `apps/web/app/(dashboard)/documents/[id]/_components/document-viewer.tsx`; `apps/web/app/(dashboard)/documents/[id]/page.tsx`; `apps/api/src/modules/documents/documents.controller.ts`; `apps/api/src/modules/documents/documents.service.ts` |
| P2 | 6. Nomenclatura documental | Depois de confirmação/QR, apresentar uma prévia editável de nome humano: `AAAA-MM-DD — Fornecedor — Nº documento — Total EUR.ext`; manter `fileName` original e a chave aleatória de storage intactos para auditoria. Aplicar fallback previsível para campos em falta e prevenir caracteres inválidos/colisões. A tabela e o cabeçalho devem preferir esse nome de negócio, com original numa linha secundária. | `apps/web/app/(dashboard)/documents/[id]/page.tsx`; `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx`; `apps/web/app/(dashboard)/documents/_components/document-table.tsx`; `apps/api/prisma/schema.prisma`; `apps/api/src/modules/documents/documents.service.ts`; `apps/api/src/modules/documents/dto/document.dto.ts` |

## Estado actual do DocFlow que orienta a ordem

O detalhe já tem a base correcta: preview à esquerda e campos à direita, badge QR, estados `NOVO/EM_REVISAO/APROVADO/REJEITADO/...`, linhas com quantidade/preço/IVA/total e relação `partyId`. Porém, o QR aparece depois do preview, a aprovação é binária, as linhas desaparecem quando vazias, o campo fornecedor não navega para a entidade, e o viewer é apenas `iframe`/`img` sem controlos de rotação/zoom. A storage key é deliberadamente aleatória; essa não deve passar a ser o nome de negócio.

## Sequência de entrega

1. QR-first + aprovação auditável (P0): reduz risco fiscal antes de aumentar superfície de UI.
2. Fornecedor ligado e linhas responsivas (P1): fecha o ciclo documento → entidade → contabilidade.
3. Viewer e nomenclatura (P1/P2): melhora revisão móvel e encontrabilidade sem mexer no original.

## Referências de código verificadas

- O cabeçalho selecciona `docNumber`, depois `fileName`, e o QR está num cartão sob o preview: `apps/web/app/(dashboard)/documents/[id]/page.tsx:225-288`.
- A aprovação é o botão simples “Aprovar”; a tabela de linhas só renderiza quando há itens: `apps/web/app/(dashboard)/documents/[id]/_components/field-panel.tsx:168-188` e `334-375`.
- O viewer usa `iframe` para PDF e `img object-contain` para imagem, sem estado de zoom/rotação: `apps/web/app/(dashboard)/documents/[id]/_components/document-viewer.tsx:176-195`.
- A entidade existe no modelo e no detalhe, mas a UI de documento expõe apenas o texto do fornecedor: `apps/api/prisma/schema.prisma:398-400`; `apps/web/app/(dashboard)/parties/[id]/page.tsx:49-56`.
