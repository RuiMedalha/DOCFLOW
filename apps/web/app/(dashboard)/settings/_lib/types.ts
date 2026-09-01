/**
 * DocFlow — Settings & Integrations types.
 *
 * Mirrors the backend `integrations`, `auth`, and `audit` modules.
 */

export type AuditActionType =
  | 'CREATE' | 'EDIT' | 'DELETE' | 'IMPORT' | 'EXPORT' | 'LOGIN' | 'LOGOUT'
  | 'MOVE' | 'APPROVE' | 'REJECT' | 'COMPLETE' | 'CANCEL' | 'OTHER' | string;

// ─────────────────────────────────────────── USERS / ROLES ────────────────

export type Role = 'ADMIN' | 'CONTABILIDADE' | 'APPROVER' | 'OPERADOR' | 'AUDITOR';

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  CONTABILIDADE: 'Contabilidade',
  APPROVER: 'Aprovador',
  OPERADOR: 'Operador',
  AUDITOR: 'Auditor',
};

export interface UserMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface InviteInput {
  email: string;
  name: string;
  role: Role;
  message?: string;
}

// ─────────────────────────────────────────── TENANT ───────────────────────

export interface TenantProfile {
  id: string;
  slug: string;
  name: string;
  nif?: string | null;
  iban?: string | null;
  country?: string | null;
  scanEmail?: string | null;
  locale?: string;
  currency?: string;
  timezone?: string;
  plan?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─────────────────────────────────────────── INTEGRATIONS ─────────────────

export type IntegrationProvider =
  | 'toconline'
  | 'moloni'
  | 'ifthenpay'
  | 'woocommerce'
  | 'hubspot'
  | 'pipedrive';

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  isActive: boolean;
  config?: Record<string, unknown> | null;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface IntegrationTestResult {
  provider: string;
  configured: boolean;
  credentials?: Record<string, unknown>;
  config?: Record<string, unknown>;
  message?: string;
}

export interface IntegrationAuthorizeResult {
  provider: string;
  oauthUrl?: string;
  redirectUri?: string;
}

export interface IntegrationConfigureInput {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  webhookSecret?: string;
  accountId?: string;
  env?: string;
  [key: string]: string | undefined;
}

// ─────────────────────────────────────────── PROVIDER PRESETS ────────────

export interface ProviderSpec {
  id: IntegrationProvider;
  name: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'email' | 'url' | 'select';
    required: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  hasOAuth?: boolean;
  syncSupported?: boolean;
}

export const PROVIDER_PRESETS: ProviderSpec[] = [
  {
    id: 'ifthenpay',
    name: 'Ifthenpay (Multibanco / MB Way)',
    description: 'Gateway de pagamento PT. Recebe callbacks de pagamento.',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'webhookSecret', label: 'Anti-phishing key', type: 'password', required: true },
      { key: 'accountId', label: 'Conta (entity code)', type: 'text', required: true },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Sincronização de encomendas e produtos com a loja online.',
    fields: [
      { key: 'apiKey', label: 'Consumer Key', type: 'password', required: true },
      { key: 'apiSecret', label: 'Consumer Secret', type: 'password', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false },
      { key: 'env', label: 'Ambiente', type: 'select', required: true, options: [
        { value: 'production', label: 'Produção' },
        { value: 'sandbox', label: 'Sandbox' },
      ] },
    ],
    syncSupported: true,
  },
  {
    id: 'toconline',
    name: 'TOConline (faturação PT)',
    description: 'Emissão de faturas e documentos via AT.',
    hasOAuth: true,
    syncSupported: true,
    fields: [],
  },
  {
    id: 'moloni',
    name: 'Moloni',
    description: 'Software de faturação PT alternativo.',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    syncSupported: true,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Sync de contactos e empresas (já coberto pelo CRM).',
    hasOAuth: true,
    syncSupported: true,
    fields: [],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    description: 'Sync de deals e pipeline (já coberto pelo CRM).',
    hasOAuth: true,
    syncSupported: true,
    fields: [],
  },
];

export function getProviderPreset(id: string): ProviderSpec | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

// ─────────────────────────────────────────── AUDIT LOG ────────────────────

export interface AuditLogEntry {
  id: string;
  action: AuditActionType;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  user?: { id: string; name: string; email: string } | null;
  metadata?: Record<string, unknown> | null;
  rowHash?: string;
  prevHash?: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogEntry[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}