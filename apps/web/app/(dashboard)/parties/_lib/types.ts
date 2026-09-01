/**
 * DocFlow — Parties module types (master Party + accounts + IBAN risk).
 */

export type PartyType = 'FORNECEDOR' | 'CLIENTE' | 'AMBOS';
export type AccountType = 'ATIVO' | 'PASSIVO' | 'CAPITAL_PROPRIO' | 'RECEITA' | 'CUSTO' | 'OUTRO';

export interface Party {
  id: string;
  type: PartyType;
  name: string;
  nif?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  iban?: string | null;
  bic?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  ibanVerified: boolean;
  ibanVerifiedAt?: string | null;
  ibanFlagged: boolean;
  ibanFlaggedReason?: string | null;
  ibanLastCheckedAt?: string | null;
  ibanRiskScore?: number | null;
  isActive: boolean;
  defaultDebitAccount?: { id: string; code: string; name: string } | null;
  defaultCreditAccount?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartyListResponse {
  items: Party[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PartyFilters {
  search: string;
  type: '' | PartyType;
  isActive: '' | 'true' | 'false';
  ibanOnly: boolean;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AccountListResponse {
  items: Account[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface IbanHistoryEntry {
  id: string;
  oldIban: string | null;
  newIban: string;
  changedBy: string;
  changedByName?: string;
  reason?: string | null;
  verified: boolean;
  createdAt: string;
}

export interface IbanRiskBreakdownItem {
  factor: string;
  score: number;
  reason: string;
}

export interface IbanRiskReport {
  iban: string;
  blacklistMatch: boolean;
  blacklistReason?: string;
  riskScore: number;
  recommendedAction: 'allow' | 'review' | 'block';
  breakdown: IbanRiskBreakdownItem[];
}

export interface IbanBlacklistEntry {
  id: string;
  iban: string;
  reason: string;
  source: string;
  createdAt: string;
}

export interface PartyInput {
  type: PartyType;
  name: string;
  nif?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  iban?: string;
  bic?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  defaultDebitAccountId?: string;
  defaultCreditAccountId?: string;
}