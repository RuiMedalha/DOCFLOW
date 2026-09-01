/**
 * DocFlow — CRM (F.6) types.
 *
 * Full TypeScript interfaces for:
 *   - Contacts (companies & individuals) + Contact Persons
 *   - Deals & Sales Pipeline Stages (Kanban)
 *   - Pipeline Definitions & Forecasting Statistics
 *   - Activities (calls, emails, meetings, tasks, notes, follow-ups)
 *   - HubSpot / Pipedrive Bulk Import & Sync History
 */

export type ContactType = 'COMPANY' | 'INDIVIDUAL';

export type DealStage =
  | 'LEAD'
  | 'QUALIFIED'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';

export type ActivityType =
  | 'CALL'
  | 'EMAIL'
  | 'MEETING'
  | 'TASK'
  | 'NOTE'
  | 'FOLLOW_UP';

export interface CrmContactPerson {
  id: string;
  contactId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface CrmContact {
  id: string;
  type: ContactType;
  name: string;
  nif?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  website?: string | null;
  industry?: string | null;
  notes?: string | null;
  tags?: string[];
  partyId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  contactPersons?: CrmContactPerson[];
  _count?: {
    deals?: number;
    activities?: number;
    contactPersons?: number;
  };
}

export interface CrmContactDetail extends CrmContact {
  contactPersons: CrmContactPerson[];
  deals?: Deal[];
  activities?: Activity[];
  party?: {
    id: string;
    name: string;
    nif?: string | null;
    iban?: string | null;
  } | null;
}

export interface ContactInput {
  type: ContactType;
  name: string;
  nif?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  industry?: string;
  notes?: string;
  tags?: string[];
  isActive?: boolean;
}

export interface ContactFilters {
  search?: string;
  type?: '' | ContactType;
  isActive?: '' | 'true' | 'false' | boolean;
}

export type CrmContactFilters = ContactFilters;

export interface ContactListResponse {
  items: CrmContact[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export type CrmContactListResponse = ContactListResponse;

// ============================================================================
// Pipeline & Deals
// ============================================================================

export interface PipelineStageConfig {
  id: string;
  name: string;
  probability?: number;
  order?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStageConfig[] | DealStage[];
  isDefault: boolean;
  createdAt?: string;
}

export interface Deal {
  id: string;
  contactId: string;
  contact?: { id: string; name: string; email?: string | null } | null;
  pipelineId?: string | null;
  pipeline?: Pipeline | null;
  title: string;
  value: number;
  currency?: string;
  stage: DealStage;
  probability?: number | null;
  expectedCloseDate?: string | null;
  expectedCloseAt?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DealInput {
  title: string;
  value: number;
  currency?: string;
  contactId: string;
  pipelineId?: string;
  stage?: DealStage;
  probability?: number;
  expectedCloseDate?: string;
  expectedCloseAt?: string;
  notes?: string;
}

export interface DealFilters {
  search?: string;
  stage?: '' | DealStage;
  pipelineId?: string;
  contactId?: string;
}

export interface DealListResponse {
  items: Deal[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface PipelineStats {
  totalValue: number;
  weightedTotal: number;
  wonValue: number;
  lostValue: number;
  winRate?: number;
  countByStage?: Record<string, number>;
  valueByStage?: Record<string, number>;
}

// ============================================================================
// Activities
// ============================================================================

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  description?: string | null;
  notes?: string | null;
  dueDate?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; email?: string } | null;
  createdById?: string;
  createdBy?: { id: string; name: string } | null;
  contactId?: string | null;
  contact?: { id: string; name: string } | null;
  dealId?: string | null;
  deal?: { id: string; title: string } | null;
  createdAt: string;
}

export interface ActivityInput {
  type: ActivityType;
  subject: string;
  description?: string;
  notes?: string;
  dueDate?: string;
  dueAt?: string;
  contactId?: string;
  dealId?: string;
  assignedToId?: string;
}

export interface ActivityListResponse {
  items: Activity[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ============================================================================
// Imports & Sync History
// ============================================================================

export interface ImportSummary {
  source: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  duplicates?: number;
}

export interface ImportResponse {
  summary: ImportSummary;
  dryRun: boolean;
}

export interface SyncHistoryEntry {
  id: string;
  source: string;
  summary: ImportSummary;
  user?: { id: string; name: string } | null;
  createdAt: string;
}

// ============================================================================
// Constants & Labels
// ============================================================================

export const DEAL_STAGES: Array<{
  id: DealStage;
  label: string;
  tone: 'sky' | 'violet' | 'amber' | 'emerald' | 'rose' | 'neutral';
}> = [
  { id: 'LEAD', label: 'Lead', tone: 'neutral' },
  { id: 'QUALIFIED', label: 'Qualificado', tone: 'sky' },
  { id: 'PROPOSAL', label: 'Proposta', tone: 'violet' },
  { id: 'NEGOTIATION', label: 'Negociação', tone: 'amber' },
  { id: 'WON', label: 'Ganho', tone: 'emerald' },
  { id: 'LOST', label: 'Perdido', tone: 'rose' },
];

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  COMPANY: 'Empresa',
  INDIVIDUAL: 'Particular',
};

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  CALL: 'Chamada Telefónica',
  EMAIL: 'Email',
  MEETING: 'Reunião',
  TASK: 'Tarefa',
  NOTE: 'Nota',
  FOLLOW_UP: 'Follow-up',
};
