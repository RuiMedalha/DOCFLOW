# LLM Gateway architecture — decisão do utilizador (2026-09-01)

## O que o utilizador quer
O acesso a CADA LLM (Gemini, OpenRouter, MiniMax, GPT/OpenAI, Claude/Anthropic) deve ser configurado como um **GATEWAY**: cada provider é uma entrada **{ url, token, model }** no .env, uniforme. Ligar/trocar um modelo = mudar a config, SEM tocar no código. As URLs NÃO devem estar hardcoded.

Estado atual: as URLs estão hardcoded em vision.service.ts (openrouter.ai, api.openai.com, generativelanguage.googleapis.com). Precisa de refactor.

## MiniMax
- Conta: **INTERNACIONAL** → endpoint base `https://api.minimax.io/v1` (ou api.minimaxi.chat — confirmar no teste). OpenAI-compatible chat/completions com visão (modelo MiniMax-VL / abab-vl).
- Chave: MINIMAX_API_KEY (o utilizador vai fornecer). É tipicamente um JWT longo (eyJ...).

## Design do gateway (a implementar)
Cada provider de visão = config uniforme:
```
<PROVIDER>_URL=<base url do chat/completions>
<PROVIDER>_TOKEN=<api key / bearer>
<PROVIDER>_MODEL=<model id>
```
Ex.:
```
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_TOKEN=sk-or-...
OPENROUTER_MODEL=google/gemini-2.5-flash

MINIMAX_URL=https://api.minimax.io/v1/text/chatcompletion_v2   (confirmar path exato)
MINIMAX_TOKEN=eyJ...
MINIMAX_MODEL=MiniMax-VL-01   (ou o vision model atual)

GEMINI_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_TOKEN=...
GEMINI_MODEL=gemini-3.6-flash
```
- GPT (OpenAI) e Claude (Anthropic) também via gateway {url, token, model} — o utilizador disse "o acesso ao gpt e ao claude faço e tem de ficar como gateway: url e token".
- Um provider só está ATIVO se tiver TOKEN configurado. Ordem de preferência configurável.
- Formato: a maioria é OpenAI-compatible (chat/completions + image_url). Gemini direto usa inline_data. O gateway abstrai isto por "tipo" (openai-compat | gemini-native | anthropic).

## Sequência
1. pane-192 termina o retry do OpenRouter (estabiliza o que já temos).
2. DEPOIS: refactor vision.service.ts para gateway {url,token,model} por provider (sem URLs hardcoded).
3. Adicionar MiniMax como provider (internacional, openai-compat).
4. Prioridade dos providers configurável; ativo = tem token.
5. Verificar: mesma foto 3x consistente com o provider escolhido.

## Falta do utilizador
- MINIMAX_API_KEY (chave da conta internacional).
