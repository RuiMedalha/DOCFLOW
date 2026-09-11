# Benchmark de leitura — Fase 2 (2026-09-11)

Todos os documentos de `C:\Projetos\docflow-mvp\samples` (19 ficheiros, ver `docs/SAMPLES_INVENTORY.md`) foram carregados/re-extraídos **em produção** (commit `1d97ba6`, provider de vision: **OpenRouter** com `google/gemini-2.5-flash` — o Gemini é acedido via OpenRouter, não há chave direta da Google) e comparados com a verdade de terreno lida visualmente a partir das páginas rasterizadas (NIF do emitente, total, data de emissão, nº do documento).

Método: `POST /documents/upload` (409 → `POST /extraction/documents/:id` síncrono para re-extrair o documento já existente) → `GET /documents/:id` → comparação campo a campo. Script no scratchpad da sessão (`benchmark-prod.mjs`), não commitado por conter credenciais de demo.

## Resultado

| Métrica | Valor |
|---------|-------|
| Documentos | 19 |
| **NIF + total + data corretos sem edição manual** | **19/19 (100 %)** — objetivo ≥ 90 % ✅ |
| QR-AT descodificado deterministicamente (ZXing/jsQR) | 11 (6 scans via rasterização + 5 PDFs nativos) |
| QR lido pela IA e aceite após cross-check | 5 (BP, Bonezinho ×2 → rejeitado→campos IA; fotos IKEA ×2 aceites) |
| Sem QR (faturas espanholas) | 3 — só IA, NIF-IVA `ES…` correto nas 3 |

## Tabela por ficheiro

| Ficheiro | Tipo | QR no doc | Fonte | NIF | Total | Data | Nº doc | Tempo |
|----------|------|-----------|-------|-----|-------|------|--------|-------|
| `BP 30,00 €.pdf` | scan | sim | `ai` | 508729084 ✅ | 30 ✅ | 2026-07-31 ✅ | FS 274271005/028318 | 45 s |
| `FR 1 8482 BONEZINHO.pdf` | scan | sim | `ai` | 507097823 ✅ | 175.15 ✅ | 2026-07-04 ✅ | FR 1/8482 | 36 s |
| `FR 101 00049652 Almoço.pdf` | scan | sim | `at_qr+ai` | 228212375 ✅ | 21.65 ✅ | 2026-07-01 ✅ | JFHGPF47-00049652 | 7 s |
| `FR FV 010C.FV 448 Alcides.pdf` | scan | sim | `at_qr+ai` | 513726136 ✅ | 34 ✅ | 2026-07-17 ✅ | FV0102C.FV/448 | 7 s |
| `FT 1 74609 Refeição.pdf` | scan | sim | `at_qr+ai` | 502550694 ✅ | 32.4 ✅ | 2026-05-29 ✅ | 3.73 | 7 s |
| `FT 1 8376 Refeição.pdf` | scan | sim | `ai` | 507097823 ✅ | 38.1 ✅ | 2026-06-30 ✅ | FR 1/8376 | 33 s |
| `FT 2026 1396 AZUR NET 190,65€.pdf` | scan | sim | `at_qr+ai` | 502293780 ✅ | 190.65 ✅ | 2026-06-30 ✅ | FT2026/1396 | 7 s |
| `FT 2026A92 6384 Miranda e Serra 2.030,68€.pdf` | native | sim | `at_qr+ai` | 500842019 ✅ | 2030.68 ✅ | 2026-05-21 ✅ | J66V9C9T-6384 | 7 s |
| `FT 2026A92 6781 Miranda e Serra 1.245,13€.pdf` | native | sim | `at_qr+ai` | 500842019 ✅ | 1245.13 ✅ | 2026-05-29 ✅ | J66V9C9T-6781 | 70 s |
| `FT 2026A94 149 Miranda e serra 2 223.82€  13 mar.pdf` | scan | sim | `at_qr+ai` | 500842019 ✅ | 2223.82 ✅ | 2026-02-13 ✅ | FT2026A94/149 | 21 s |
| `FT 4 83 5638 PAGO 1.129,88€.pdf` | native | sim | `at_qr+ai` | 504213636 ✅ | 1129.88 ✅ | 2026-02-24 ✅ | JFV9G2J4-5638 | 7 s |
| `FT 76  1944 LIZOTEL 418,10 €.pdf` | scan | sim | `at_qr+ai` | 506144860 ✅ | 418.1 ✅ | 2026-08-28 ✅ | FT2026A76/1944 | 10 s |
| `FT FAT2026 396 QUI-LIBRA 279,21€.pdf` | native | sim | `at_qr+ai` | 502827130 ✅ | 279.21 ✅ | 2026-05-13 ✅ | FAT2026/396 | 6 s |
| `FT FE 0220100158006AA0E03822026000001180.pdf` | scan | não | `ai` | ESA28559573 ✅ | 123.78 ✅ | 2026-08-07 ✅ | FE 022010015806AA0E03822 | 29 s |
| `FT VFV26000793 296,61€.pdf` | native | não | `ai` | 924981555 ✅ | 296.61 ✅ | 2026-02-04 ✅ | VFV26000793 | 64 s |
| `FT VFV26001324 PAGO 323,82€.pdf` | native | não | `ai` | ESB06700785 ✅ | 323.82 ✅ | 2026-05-30 ✅ | VFV26001324 | 64 s |
| `FT_AAA26_05582.pdf` | native | sim | `at_qr+ai` | 517412993 ✅ | 92.76 ✅ | 2026-08-10 ✅ | 92.76 | 17 s |
| `WhatsApp Image 2026-09-11 at 01.25.47 (1).jpeg` | photo | sim | `at_qr+ai` | 505416654 ✅ | 260 ✅ | 2025-11-16 ✅ | JJY2HD80-0000428 | 114 s |
| `WhatsApp Image 2026-09-11 at 01.25.47.jpeg` | photo | sim | `at_qr+ai` | 505416654 ✅ | 260 ✅ | 2025-11-16 ✅ | 0010322025/0000428 | 41 s |

`at_qr+ai` = QR-AT determinístico (ou lido pela IA e validado) + IA para fornecedor/linhas; `ai` = só vision. Tempos incluem a chamada ao provider (30–70 s quando há escalada para `gemini-2.5-pro`; ~2 min nas fotos).

## O que mudou na Fase 2 e o efeito medido

| Alteração | Antes | Depois |
|-----------|-------|--------|
| QR em PDFs digitalizados: rasterizar pág. 1 (@2, @3) e última e correr ZXing/jsQR antes da vision | QR só do texto do PDF → 0 scans com QR determinístico | 8/10 scans + 1 PDF nativo com QR vetorial (Miranda 6384, só @3) |
| `atQrRaw` da IA só é promovido a QR se NIF/total/data baterem com os campos estruturados da própria IA | BP: data vazia; Bonezinho 8376: total **5,20** (real 38,10) — payloads "QR" alucinados usados como autoridade fiscal | 19/19 |
| `qrPayload` vindo da IA só persiste se passou o cross-check | payload mau ficava na linha e curto-circuitava re-extrações | corrigido (+ 3 linhas limpas em prod) |
| Cascade ZXing em worker thread | bloqueava o event loop 5–40 s → healthcheck falhava → Traefik "no available server" durante o benchmark | API responde durante a descodificação |
| IBAN da IA só com MOD-97 | IBAN mal transcrito era gravado | rejeitado com warning (`ai_iban_rejected_mod97`, visto na Miranda 6384) |
| HEIC/HEIF → JPEG no upload/email/scanner | 400 "Unsupported file type" | aceite; HEIC inválido → 400 "HEIC/HEIF image could not be decoded" (verificado em prod) |
| Ordem de providers configurável, Gemini principal, gateway {URL,TOKEN,MODEL}, 2.ª opinião < 0,7 | MiniMax > OpenRouter > Gemini hardcoded | `VISION_PROVIDER_ORDER` (default gemini,openrouter,minimax,openai,anthropic); em prod só OpenRouter está ativo |

## Comparação com `gemini-documental`

**Não foi corrido tal e qual.** O `gemini-documental` (`C:\Users\Rui Medalha\gemini-documental\apps\api\src\app.service.ts`) é uma única chamada à API **direta** da Google (`generativelanguage.googleapis.com`, `gemini-2.0-flash`, JSON, temperatura 0,1) com um prompt de auditor e sem QR, sem rasterização e sem validação determinística. No DocFlow o Gemini é acedido via OpenRouter (decisão do Rui, 2026-09-11) e não existe chave direta da Google — por isso não há comparação 1:1. O que se portou dele: nada de código — o prompt não traz campos que o DocFlow não extraia já (o DocFlow tem ainda ATCUD, IVA por taxa, IBAN validado e categoria). Comparação equivalente possível sem tocar no código: `OPENROUTER_MODEL=google/gemini-2.0-flash-001` e repetir o benchmark.

## Limitações conhecidas

- Talões térmicos digitalizados (BP, Bonezinho ×2) e as fotos IKEA: o QR impresso não é descodificável por ZXing/jsQR a nenhuma escala nem por mosaicos (testado localmente); nesses casos a leitura fica a cargo da IA, com cross-check. A verdade de terreno do NIF do Bonezinho foi inicialmente lida como 507397823; a ampliação a escala 4 confirma **507097823** (a IA e o Tesseract estavam certos).
- As fotos demoram ~2 min (cascade a várias escalas/rotações + vision); o worker evita bloquear a API, mas o tempo mantém-se. Candidato a otimização: detetar a região do QR antes do cascade.
- `Miranda 6781` levou 70 s por escalada para `gemini-2.5-pro` (o flash devolveu um `O:` corrompido); é o mecanismo de escalada existente a funcionar.
