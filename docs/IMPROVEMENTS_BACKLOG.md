# Backlog de melhorias — pós-leitura (decisões utilizador 2026-09-01)

A LEITURA de imagens JÁ FUNCIONA (MiniMax-M3, 4/4 consistente, supplier/total/IVA corretos, fila serial). Isto é o que MELHORAR a seguir, aproveitando o que já temos. Referências: um programa português organizado (screenshots WhatsApp 14.40.24-28 em .overclock-app/dropped) + https://www.dorifinance.com/en/

## Pedidos concretos do utilizador (a última mensagem)
1. **QR code lido PRIMEIRO** — antes da IA, para dar CERTEZA dos dados fiscais. Hoje o MiniMax lê os dados visualmente mas o QR determinístico não corre primeiro. Queremos: descodificar o QR (ZXing) → parseAtQr → dados fiscais AUTORITÁRIOS; a IA só complementa (nome fornecedor, linhas). ZXing é a lib a usar (jsQR falha em fotos).
2. **Aprovação** — falta o fluxo de APROVAR o documento (onde está o botão/estado de aprovação?). Deve existir aprovar → muda estado.
3. **Dados dos produtos (linhas)** — mostrar as linhas de fatura (produtos: descrição, qtd, preço, IVA) no detalhe. Já extraímos lineItems para metadata; falta MOSTRAR/gravar em DocumentItem.
4. **Ficha do fornecedor** — ver/abrir a ficha do fornecedor a partir do documento (o Party já é criado; falta o ecrã/link).
5. **Imagem na horizontal** — a foto aparece deitada (rotação errada). Corrigir orientação (EXIF orientation) ao mostrar/guardar.
6. **Nome ao ficheiro** — dar um nome legível ao documento/ficheiro (hoje é "image.jpg" / hash). Nome sugerido a partir dos dados (ex: Fornecedor_Data_NrDoc).

## Referências a analisar
- Screenshots do programa português organizado (.overclock-app/dropped/WhatsApp Image 2026-09-01 at 14.40.24-28*.jpeg) — ver a ORGANIZAÇÃO/UI/fluxos deles para aproveitar.
- https://www.dorifinance.com/en/ — produto de apoio/inspiração.

## Nota de método
O utilizador (com razão) quer aproveitar o que já temos e melhorar por cima. A leitura está feita. Estas são melhorias de UX/fluxo/organização + o reforço determinístico do QR.
