# DocFlow — Guia de Integração: Caixas de Correio (Email) & OneDrive

> **Caminho deste documento:** `C:\Projetos\docflow-mvp\docs\INTEGRACOES_EMAIL_ONEDRIVE.md`  
> **Data:** 14 de Setembro de 2026  
> **Estado:** Implementado (Gmail, Outlook OAuth, IMAP, Scanner) + Especificação Pronta (OneDrive)

---

## 1. O que já está Desenvolvido e Funcional no Código

O DocFlow já possui suporte multicanal nativo para ingestão automática de faturas no módulo `apps/api/src/modules/email-inbound` e `apps/api/src/modules/inbound`.

### 1.1 Canais de Correio Existentes

| Canal | Tipo de Ligação | Como Funciona | Origem no DocFlow | Ficheiros de Código |
|---|---|---|---|---|
| **Outlook / Office 365** | OAuth 2.0 (Microsoft Graph) | Conexão em 1 clique via Microsoft Identity. Poller automático a cada 5 min faz download de anexos (PDF, JPG, PNG, DOCX) de emails não lidos. | `OUTLOOK` | [`apps/api/src/modules/email-inbound/outlook.service.ts`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/email-inbound/outlook.service.ts)<br>[`apps/api/src/modules/email-inbound/poller.service.ts`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/email-inbound/poller.service.ts) |
| **Gmail** | OAuth 2.0 (Google API) | Conexão em 1 clique via Google Consent. Poller automático a cada 5 min recolhe anexos de emails não lidos. | `GMAIL` | [`apps/api/src/modules/email-inbound/gmail.service.ts`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/email-inbound/gmail.service.ts) |
| **IMAP Genérico**<br>(ex: `faturacao@hotelequip.pt`) | IMAP com TLS | Suporte para qualquer servidor de email (cPanel, Exchange, etc.). Credenciais encriptadas com AES-256-GCM na BD. | `EMAIL` | [`apps/api/src/modules/inbound/inbound.service.ts`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/inbound/inbound.service.ts) |
| **Scanner / Pasta Local** | File Watcher (`chokidar`) | Vigia uma pasta no disco (`SCANNER_PATH`). Qualquer PDF colocado na pasta é consumido no pipeline. | `SCANNER` | [`apps/api/src/modules/scanner/scanner.service.ts`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/scanner/scanner.service.ts) |

---

## 2. O que Existia nos Ficheiros MD sobre as Credenciais do Graph

Nos ficheiros `.md` e de configuração do repositório:
- **No documento de planeamento**: [`docs/sprints/sprint-d-apply-components/sprint-f-inbox-multicanal/SCOUT_REPORT.md`](file:///C:/Projetos/docflow-mvp/docs/sprints/sprint-d-apply-components/sprint-f-inbox-multicanal/SCOUT_REPORT.md) (linhas 240 a 260), está registada a especificação técnica da integração com a Microsoft Graph API:
  - Auth URL: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
  - Token URL: `https://login.microsoftonline.com/common/oauth2/v2.0/token`
  - Graph API endpoint: `https://graph.microsoft.com/v1.0/me/messages`
  - Scopes configurados: `offline_access`, `Mail.Read`, `User.Read`
- **No ficheiro `.env`**: Em [`apps/api/.env`](file:///C:/Projetos/docflow-mvp/apps/api/.env) (linhas 42 a 46):
  ```env
  # Sprint F — Outlook / Microsoft Graph OAuth (read-only). Scopes:
  #   offline_access + Mail.Read + User.Read
  MICROSOFT_CLIENT_ID=
  MICROSOFT_CLIENT_SECRET=
  MICROSOFT_REDIRECT_URI=http://localhost:4000/api/v1/email-inbound/oauth/microsoft/callback
  ```
- **Nota de Segurança**: As chaves reais secretas (`client_secret` ou ID de aplicação registada no Azure) **não estavam preenchidas** no repositório nem commitadas em texto simples nos `.md` por boas práticas de segurança (ficando os campos prontos a receber os valores do Azure/Entra ID).

---

## 3. Como Registar a App no Microsoft Azure (Entra ID) para Ativar Outlook & OneDrive

Para obter o `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET`:

1. Aceder ao portal do **Microsoft Entra ID / Azure**: [portal.azure.com](https://portal.azure.com) ou [entra.microsoft.com](https://entra.microsoft.com).
2. Ir a **App registrations (Registo de aplicações)** → **New registration (Novo registo)**:
   - **Nome:** `DocFlow Inbound`
   - **Tipos de conta suportados:** *Contas em qualquer diretório organizacional (Qualquer diretório Microsoft Entra ID - Multi-inquilino) e contas Microsoft pessoais (ex: Skype, Xbox)* — ou apenas da organização HotelEquip.
   - **URI de Redirecionamento (Web):**
     - Desenvolvimento: `http://localhost:4000/api/v1/email-inbound/oauth/microsoft/callback`
     - Produção: `https://r122tccopibb6pov1fmrau9v.167.86.111.8.sslip.io/api/v1/email-inbound/oauth/microsoft/callback` (ou domínio próprio).
3. Após criar, copiar o **Application (client) ID** → este é o `MICROSOFT_CLIENT_ID`.
4. No menu lateral, ir a **Certificates & secrets (Certificados e segredos)** → **New client secret (Novo segredo de cliente)**:
   - Adicionar uma descrição e prazo de validade (ex: 24 meses).
   - Copiar imediatamente o **Value (Valor)** do segredo → este é o `MICROSOFT_CLIENT_SECRET`.
5. No menu lateral, ir a **API permissions (Permissões de API)** → **Add a permission (Adicionar permissão)** → **Microsoft Graph** → **Delegated permissions (Permissões delegadas)**:
   - Para Outlook:
     - `offline_access` (obrigatório para manter a ligação ativa sem pedir login sempre)
     - `Mail.Read` (leitura de emails e anexos)
     - `User.Read` (leitura do perfil e endereço de email)
   - Para OneDrive:
     - `Files.Read` ou `Files.Read.All` (leitura de ficheiros de pastas do OneDrive)

---

## 4. Como Ligar o OneDrive ao DocFlow

O conector OneDrive reutiliza 100% da mesma infraestrutura de autenticação do Outlook já implementada no DocFlow.

### 4.1 Abordagem Nativa Cloud (Microsoft Graph)
1. **Adicionar o scope de ficheiros**: Na autorização Microsoft, juntar `Files.Read` ao `MS_SCOPES`.
2. **Serviço de Polling**: Criar o `OneDriveService` que chama o endpoint do Microsoft Graph:
   ```http
   GET https://graph.microsoft.com/v1.0/me/drive/root:/DocFlow/Entrada:/children
   ```
3. **Fluxo Automático**:
   - O fornecedor ou operador guarda a fatura numa pasta partilhada do OneDrive (ex: `/DocFlow/Entrada`).
   - O DocFlow deteta os novos ficheiros via Graph API.
   - Faz o download para o pipeline com origem `ONEDRIVE`.
   - Move o ficheiro no OneDrive para a pasta `/DocFlow/Processados` para evitar duplicados.

### 4.2 Abordagem Alternativa: Scanner Local
Se a pasta do OneDrive estiver sincronizada localmente no PC ou montada no servidor:
- O módulo [`ScannerService`](file:///C:/Projetos/docflow-mvp/apps/api/src/modules/scanner/scanner.service.ts) já existe no DocFlow.
- Basta configurar o caminho da pasta em `SCANNER_PATH` (ex: `C:\Users\...\OneDrive - HotelEquip\Faturas`) e iniciar o serviço no separador **Scanner** da UI.

---

## 5. Resumo dos Ficheiros do Projeto Envolvidos

- **Serviço Outlook (Microsoft Graph)**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\email-inbound\outlook.service.ts`
- **Poller em Background (Cron 5 minutos)**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\email-inbound\poller.service.ts`
- **Serviço Gmail**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\email-inbound\gmail.service.ts`
- **Serviço IMAP (Email Geral)**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\inbound\inbound.service.ts`
- **Serviço Scanner (Pasta Local / OneDrive Sincronizado)**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\scanner\scanner.service.ts`
- **Controlador OAuth**:  
  `C:\Projetos\docflow-mvp\apps\api\src\modules\email-inbound\oauth.controller.ts`
- **Interface Frontend de Configuração**:  
  `C:\Projetos\docflow-mvp\apps\web\app\(dashboard)\documents\_components\email-config.tsx`
