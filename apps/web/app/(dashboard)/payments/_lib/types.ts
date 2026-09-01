/**
 * DocFlow — Payments (F.7) types.
 *
 * Full TypeScript interfaces for:
 *   - Payables (Contas a Pagar)
 *   - Approvals & Mark-as-paid workflows
 *   - Payment Schedules & Calendar view (recurring expansion)
 *   - ISO 20022 SEPA pain.001 XML & Homebanking CSV exports
 */

export type PaymentStatus =
  | 'DRAFT'
  | 'TO_PAY'
  | 'SCHEDULED'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED';

export type RecurrenceType =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY';

export interface PayableItem {
  id: string;
  tenantId?: string;
  description?: string | null;
  amount: number;
  dueDate?: string | null;
  status: PaymentStatus;
  approved?: boolean;
  paidAt?: string | null;
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  notes?: string | null;
  partyId?: string | null;
  party?: {
    id: string;
    name: string;
    nif?: string | null;
    iban?: string | null;
    ibanVerified?: boolean;
    ibanFlagged?: boolean;
  } | null;
  documentId?: string | null;
  document?: {
    id: string;
    fileName: string;
    docNumber?: string | null;
    total?: number | null;
  } | null;
  approvedById?: string | null;
  approvedBy?: {
    id: string;
    name: string;
  } | null;
  approvedAt?: string | null;
  bankTxId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type Payable = PayableItem;

export interface SepaExportResult {
  numberOfTransactions: number;
  controlSum: number;
  messageId?: string;
}

export interface PayableInput {
  description: string;
  amount: number;
  dueDate?: string;
  partyId?: string;
  notes?: string;
}

export interface PayableFilters {
  status?: string;
  search?: string;
  partyId?: string;
  approvedOnly?: boolean;
  overdueOnly?: boolean;
  dueDateFrom?: string;
  dueDateTo?: string;
}

export interface PayableListResponse {
  items: PayableItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ============================================================================
// Payment Schedules & Calendar
// ============================================================================

export interface PaymentSchedule {
  id: string;
  title: string;
  description?: string | null;
  amount: number;
  currency: string;
  dueDate: string;
  paymentDate?: string | null;
  status: PaymentStatus;
  category?: string | null;
  paymentMethod?: string | null;
  recurring: boolean;
  recurrenceType?: RecurrenceType | null;
  recurrenceInterval?: number | null;
  crmContactId?: string | null;
  documentId?: string | null;
  createdById?: string;
  createdBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentScheduleInput {
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  dueDate: string;
  category?: string;
  paymentMethod?: string;
  recurring?: boolean;
  recurrenceType?: RecurrenceType;
  recurrenceInterval?: number;
  crmContactId?: string;
  documentId?: string;
}

export interface PaymentScheduleListResponse {
  items: PaymentSchedule[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface CalendarOccurrence {
  id: string;
  sourceScheduleId: string;
  title: string;
  amount: number;
  dueDate: string;
  isProjected: boolean;
  status: PaymentStatus;
  category?: string | null;
}

export interface SepaExportInput {
  payableIds: string[];
  debtorIban: string;
  debtorName: string;
  debtorBic?: string;
  executionDate?: string;
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  DRAFT: 'Rascunho',
  TO_PAY: 'A Pagar',
  SCHEDULED: 'Agendado',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
};

export const PAYMENT_STATUS_TONE: Record<
  PaymentStatus,
  'neutral' | 'sky' | 'amber' | 'emerald' | 'rose'
> = {
  DRAFT: 'neutral',
  TO_PAY: 'amber',
  SCHEDULED: 'sky',
  PAID: 'emerald',
  OVERDUE: 'rose',
  CANCELLED: 'neutral',
};
