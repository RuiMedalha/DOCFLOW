# Leitura do QR-AT por fotografia — referência (pesquisa web, 2026-09-01)

## O que é o QR-AT / ATCUD (especificação oficial)

Desde 1 de janeiro de 2022, toda a fatura emitida por software certificado pela AT em Portugal tem de incluir um **Código QR** e o **ATCUD** (Código Único de Documento). O QR é obrigatório e legível por máquina — a própria app e-Fatura da AT lê-o.

### Campos do QR-AT (o payload é `A:...*B:...*C:...` separado por `*`)
| Campo | Significado |
|-------|-------------|
| **A** | NIF do emitente (fornecedor) — deve bater com o fornecedor impresso |
| **B** | NIF do adquirente (cliente) |
| **C** | País |
| **D** | Tipo de documento (FT/FR/FS/NC/ND) |
| **F** | Data do documento |
| **G** | Identificação única do documento (número) |
| **H** | **ATCUD** |
| **I1–I8** | Detalhe fiscal por espaço fiscal e taxa (base + IVA por taxa) |
| **N** | Total de impostos (IVA) |
| **O** | **Total do documento** |
| **P** | Retenção na fonte (se existir) |
| **Q** | Hash |
| **R** | Número de certificação do programa |

**Formato ATCUD:** `ATCUD:CódigoValidaçãoSérie-NúmeroSequencial`, colocado imediatamente acima do QR Code.

### Porque é ouro para nós
O QR-AT contém os campos fiscais **exatos e oficiais** (NIF emitente, NIF cliente, data, total, IVA por taxa, ATCUD). Se lermos o QR corretamente, temos os números **garantidos** — sem depender de a IA "ler" bem os montantes. É por isso que ler o QR é crítico e porque os números corrompidos (31 milhões) nunca deviam acontecer se o QR for lido.

## Como decodificar o QR de uma FOTO (o desafio técnico)

### Bibliotecas JS
- **jsQR** — pure JS, simples. Recebe `Uint8ClampedArray` RGBA + width + height. **Limitação chave (confirmada na pesquisa): funciona bem em imagens de ficheiro/limpas, mas falha em QR físicos fotografados** (pequenos, inclinados, baixa qualidade). É exatamente o nosso problema.
- **ZXing** (@zxing/library) — mais robusto, mais formatos, mas low-level.
- **QrScanner** — outra alternativa.

### A LIÇÃO CRÍTICA (do qr-decoder.com, que é "enterprise-grade"):
> **Cadeia de fallback de 4 motores:** jsQR → ZXing → pré-processamento melhorado → QrScanner. Se um motor falha, o próximo tenta automaticamente, para sempre obter resultado. **"Handles damaged, low-quality, and complex QR codes."**

**Ou seja: um único decoder (jsQR) NUNCA chega para fotos reais.** É preciso uma cadeia com pré-processamento (grayscale, contraste, redimensionar, rodar) + múltiplos motores.

## Duas estratégias válidas (e a que o gemini-documental usa)

### Estratégia A — Decoder de QR na imagem (jsQR/ZXing + pré-processamento)
Decodificar o QR dos pixels. Requer a cadeia de fallback + pré-processamento. Difícil de acertar em fotos reais (é o que temos tentado com jsQR sozinho e falha).

### Estratégia B — Deixar o modelo de VISÃO ler tudo (o método gemini-documental) ✅ RECOMENDADO
O gemini-documental **não decodifica o QR** — envia a foto ao Gemini vision, que **lê a fatura como um humano** (incluindo os valores impressos: total, NIF, IVA, ATCUD). Config: `inline_data` + `response_mime_type: application/json` + `temperature: 0.1`. Simples e lê "maravilhosamente bem" (palavras do utilizador).

### Estratégia C — HÍBRIDA (a melhor para ~100%)
1. **Vision (Gemini) lê os campos impressos** da fatura (total, NIF, fornecedor, IVA, datas, linhas) — é o que uma pessoa vê.
2. **Em paralelo, tentar decodificar o QR** (cadeia jsQR→ZXing→pré-processamento). Se conseguir, os campos do QR (A/B/F/G/H/N/O) são **autoritativos** e corrigem/confirmam o que a vision leu.
3. Se o QR não decodificar (foto má), fica só a vision — mas os NÚMEROS vêm dos campos impressos que a vision lê, **nunca de regex inventado**.

## Conclusão para a nossa implementação
- **Parar de depender do jsQR sozinho** — falha em fotos reais (confirmado pela pesquisa).
- **Adotar a config do gemini-documental** para a vision (temperature 0.1, JSON mode) — é o que garante os montantes corretos.
- **Nunca deixar regex inventar números numa imagem** — a fonte é a vision (campos impressos) e/ou o QR decodificado.
- **Opcional/futuro:** cadeia de fallback multi-motor (jsQR→ZXing→pré-processamento) para decodificar o QR quando a foto tiver qualidade, dando os campos fiscais exatos por cima da leitura da vision.

Fontes: FAQ AT (QR Code obrigatório), invoicedataextraction.com (campos A–R), qr-decoder.com (cadeia 4 motores), github/cozmo/jsQR, scanbot.io (limitações jsQR em fotos físicas).
