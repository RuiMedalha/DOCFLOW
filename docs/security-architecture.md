# DocFlow SaaS — Arquitetura de Segurança

> Estado: baseline obrigatório para o MVP multi-tenant. As decisões abaixo são requisitos de implementação e operação; não devem ser substituídas por controlos apenas na aplicação.

## 1. Princípios e fronteiras

DocFlow processa documentos financeiros, fornecedores, dados laborais e credenciais de integrações. Cada organização é um **tenant** e é uma fronteira de segurança: um utilizador, token, query, ficheiro, evento de auditoria e credencial de integração pertence exatamente a um tenant. O identificador do tenant vem do JWT verificado, nunca exclusivamente de um header, parâmetro ou corpo do pedido.

Defesa em profundidade: TLS 1.2+ na borda, autenticação forte, autorização no serviço, RLS na base de dados, validação de entrada, cifragem, logs imutáveis e monitorização. A aplicação usa uma ligação PostgreSQL sem `BYPASSRLS`; tarefas administrativas usam uma identidade separada, auditada e de curta duração.

## 2. Modelo de ameaça

| Ameaça | Impacto | Mitigações obrigatórias |
|---|---|---|
| Acesso cruzado entre tenants (IDOR, query sem filtro) | Exposição/alteração de documentos e dados pessoais | `tenant_id` em todas as tabelas de negócio, RLS `FORCE`, contexto transacional e testes negativos cross-tenant |
| Roubo/reutilização de access ou refresh token | Sequestro de conta | Access JWT curto (10–15 min), refresh opaco rotativo, hashes dos refresh tokens, deteção de reutilização e revogação da família |
| Password spraying, credential stuffing e enumeração | Acesso indevido | bcrypt, MFA obrigatório para perfis privilegiados, rate limit por IP+conta, mensagens de erro neutras, alertas |
| Phishing/MITM de autenticação | Compromisso de sessão | WebAuthn passkeys preferenciais, TOTP como alternativa, TLS/HSTS, cookies `HttpOnly; Secure; SameSite=Lax/Strict` |
| Elevação indevida de privilégios | Aprovações ou pagamentos fraudulentos | RBAC deny-by-default, guards e autorização por recurso, segregação de funções, auditoria |
| Troca de IBAN de fornecedor | Pagamento para conta fraudulenta | Normalização/validação IBAN, histórico, período de arrefecimento, aprovação em quatro olhos e alertas |
| Callback OAuth/pagamento forjado ou repetido | Importação/pagamento indevido | state/PKCE, validação de assinatura e timestamp, idempotência, allowlist e secret rotativo |
| SQLi/XSS/SSRF/upload malicioso | Exfiltração ou execução | DTO validation whitelist, queries parametrizadas, CSP, URL allowlist, antivírus/limites de ficheiros |
| Alteração de evidência/auditoria | Falha forense e compliance | Log append-only hash-chained, permissões restritas, exportação periódica para armazenamento WORM |

## 3. Isolamento multi-tenant na base de dados

Cada tabela de domínio inclui `tenant_id uuid NOT NULL REFERENCES tenants(id)`. Índices únicos e chaves estrangeiras compostas devem incluir o tenant, por exemplo `UNIQUE (tenant_id, external_id)` e `FOREIGN KEY (tenant_id, vendor_id) REFERENCES vendors(tenant_id, id)` quando aplicável. Não usar defaults baseados em headers.

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

REVOKE ALL ON invoices FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO docflow_app;
```

No início de **cada** transação, depois de verificar o JWT, a camada de dados executa `SELECT set_config('app.tenant_id', $1, true)` com o `tenantId` do token. A opção `true` limita o contexto à transação, impedindo fuga num pool de ligações. A transação deve falhar se esse contexto estiver ausente. Jobs assíncronos e webhooks resolvem o tenant a partir de um registo interno autenticado e também estabelecem o contexto antes de qualquer query.

RLS não substitui autorização: por exemplo, um OPERADOR do tenant só pode ler/alterar recursos que o seu papel permite. Testes de integração devem provar que um token do tenant A recebe zero linhas/403 para IDs do tenant B, inclusive em relações, pesquisa, exportações e storage de ficheiros.

## 4. Autenticação e autorização API

1. `POST /auth/login` recebe email/password, aplica rate limit e verifica password com bcrypt (custo mínimo 12, calibrado no deploy). Nunca devolve se a conta existe.
2. Se configurado, exige desafio WebAuthn; TOTP é fallback, com códigos de recuperação cifrados e usados uma vez. ADMIN e APPROVER devem ter MFA obrigatório; exigir step-up recente para mudanças de IBAN, pagamentos e credenciais.
3. A emissão produz um access JWT assinado assimetricamente (ES256/RS256), válido 10–15 min, com `sub`, `tenant_id`, `roles`, `sid`, `jti`, `iat`, `exp`, `iss` e `aud`. Validar assinatura, emissor, audiência, expiração e `jti` em todos os pedidos.
4. O refresh token é aleatório, opaco, de uso único e entregue apenas em cookie seguro. Guardar somente SHA-256/HMAC do token, `sid`, tenant, expiração, device e estado. Em refresh, rodar token; reutilização de token já rodado revoga toda a família e notifica o utilizador.
5. Logout revoga a sessão/família. Alteração de password, papel ou MFA revoga sessões relevantes. Tokens de serviço têm scopes mínimos, expiração curta e não substituem utilizadores.
6. `JwtGuard` verifica a identidade; `TenantGuard` confirma a coerência do tenant; `RbacGuard` aplica papéis declarados por endpoint. Ordem: JWT → tenant → RBAC → autorização por recurso.

Papéis base: `ADMIN` administra tenant e utilizadores; `CONTABILIDADE` gere documentos e lançamentos; `GESTOR_RH` gere apenas RH; `OPERADOR` executa operações permitidas; `APPROVER` aprova dentro dos seus limites. Não atribuir implicitamente permissões de ADMIN a nenhum outro papel. Limites de aprovação são atributos de política, não apenas um papel.

## 5. Lógica anti-fraude de IBAN

1. Normalizar (remover espaços, uppercase) e validar comprimento, país permitido e checksum mod-97 antes de persistir.
2. Criar `vendor_bank_accounts` com `tenant_id`, fornecedor, IBAN cifrado, `iban_fingerprint` HMAC para comparação, estado e datas. Nunca usar um hash simples de IBAN como segredo resistente a adivinhação.
3. Uma conta já aprovada para o mesmo fornecedor é de baixo risco; uma nova conta, alteração de beneficiário, país inesperado, ou mudança pouco antes de pagamento é de risco elevado.
4. Alteração de IBAN cria uma proposta `PENDING_VERIFICATION`, conserva o anterior, bloqueia pagamentos ao novo IBAN durante período de arrefecimento (por defeito 24 h) e exige confirmação fora de banda pelo contacto verificado do fornecedor e aprovação por dois utilizadores distintos (um não pode aprovar a própria alteração).
5. Antes de pagamento, revalidar estado, histórico, aprovadores e sinais de risco. Duplicados por fingerprint noutro fornecedor, muitas alterações, aprovação recente e desvio do padrão criam caso de revisão manual. Registar cada decisão no log imutável.

## 6. Auditoria imutável com hash-chain

```sql
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_type text NOT NULL,             -- USER, SERVICE, WEBHOOK
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  request_id uuid,
  ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, -- sem passwords, tokens ou IBAN em claro
  previous_hash char(64),
  event_hash char(64) NOT NULL
);
CREATE INDEX audit_events_tenant_time ON audit_events (tenant_id, occurred_at, id);
```

Para cada tenant, serializar canonicamente os campos imutáveis e calcular `event_hash = SHA-256(previous_hash || canonical_event)`. A escrita é feita numa transação bloqueada por tenant para preservar a ordem. A função de base permite apenas `INSERT` ao papel de auditoria; `UPDATE` e `DELETE` são revogados e tabelas de negócio não escrevem diretamente. Uma tarefa diária verifica cadeias, guarda o hash-raiz assinado em armazenamento WORM/externo e alerta para falhas. O encadeamento torna adulteração detetável, não substitui backups, controlo de acesso ou retenção legal.

## 7. Segurança de transporte, API e aplicação

- HTTPS obrigatório; HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `Permissions-Policy` mínima.
- Helmet com CSP restritiva, sem `unsafe-inline` quando possível; CSP por nonce para UI. Cookies de sessão sem acesso JavaScript.
- CORS allowlist exata por ambiente (`https://app.docflow.pt` etc.), métodos/cabeçalhos mínimos, `credentials: true` somente para origens explícitas; nunca `*` com credenciais.
- DTOs com `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, limites de tamanho/paginação, schemas para callbacks e sanitização de output.
- Rate limiting distribuído (Redis): login por IP+conta, MFA e reset agressivos; API por tenant+utilizador+rota; limites separados para uploads/callbacks. Responder 429 com `Retry-After` e auditar anomalias.
- Cifrar dados sensíveis em repouso com envelope encryption AES-256-GCM: DEK por tenant/registo, KEK em KMS/Vault; guardar versão/chave/nonce/tag. TLS cifra o transporte. Backups e storage de documentos também cifrados.

## 8. Integrações

**TOConline OAuth:** authorization code + PKCE, `state` ligado a sessão/tenant e de uso único; callbacks com redirect URI fixa; access/refresh tokens cifrados por tenant, scopes mínimos, rotação e revogação na desconexão. Nunca colocar tokens no browser, logs ou JWT do utilizador.

**Ifthenpay:** aceitar callbacks apenas no endpoint dedicado HTTPS; validar assinatura/HMAC com secret guardado em Vault, timestamp e nonce; impor idempotência por referência de transação; confirmar valor/moeda/estado contra a intenção interna antes de marcar pago. Não confiar no IP como controlo único.

**PSD2 Open Banking:** consentimento explícito e registado, OAuth mTLS/PKCE conforme ASPSP, tokens cifrados e com acesso mínimo, expiração/renovação controlada, associação rígida a tenant/consentimento e revogação imediata. Nunca reutilizar tokens entre tenants.

## 9. Segredos e operação

`.env` só contém referências/configuração não sensível em desenvolvimento e nunca é versionado. Produção obtém segredos em runtime de Vault/KMS/secret manager com identidade de workload, menor privilégio, rotação, expiração e auditoria. Separar chaves por ambiente e propósito: assinatura JWT, cifragem, HMAC de callback, OAuth e base de dados. Não escrever segredos em logs, erros, snapshots, tickets ou audit metadata. Fazer scan de segredos no CI e bloquear merges com deteções.

Monitorizar falhas de login/MFA, refresh reuse, 403 cross-tenant, mudanças de papéis/IBAN, falhas de hash-chain e callbacks inválidos. Definir processo de incidente para revogar chaves/sessões, preservar evidência e notificar DPO/clientes dentro dos prazos aplicáveis.

## 10. Checklist de conformidade

| Área | Verificação de aceitação |
|---|---|
| GDPR/LGPD | Registo de tratamento, base legal, minimização, retenção/eliminações, DPA com subcontratantes, DPIA para alto risco, DPO/contacto, direitos do titular e processo de incidente/notificação documentados. |
| Segurança de dados | RLS forçado e testado, cifragem AES-256-GCM, TLS, backups cifrados/restauráveis, gestão de chaves e segregação de ambientes. |
| Identidade | bcrypt calibrado, MFA para privilegiados, refresh rotation, revogação, WebAuthn/TOTP seguro, RBAC e revisão periódica de acessos. |
| API e aplicação | Helmet/CSP, CORS allowlist, validação estrita, rate limiting, scans SAST/dependências/segredos, pentest antes de produção. |
| Auditoria | Eventos críticos completos, append-only, hash-chain verificada, exportação WORM, retenção e acesso ao log controlados. |
| ISO 27001 | Inventário/avaliação de risco, políticas aprovadas, controlos de acesso/fornecedores/continuidade, gestão de vulnerabilidades, formação, evidência de auditorias e melhoria contínua no SGSI. |
| Pagamentos e integrações | Segredos em Vault, OAuth/PKCE, callbacks assinados/idempotentes, consentimento PSD2, fluxo IBAN com verificação e dupla aprovação. |
