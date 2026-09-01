import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCsvTemplateDto,
  PreviewCsvDto,
  ImportCsvDto,
  ImportCamtDto,
  UpdateCsvTemplateDto,
  BankTransactionQueryDto,
} from './dto/banking.dto';
import {
  parseCsvContent,
  computeFileHash,
  computeRowHash,
} from './csv-parser.util';
import { parseCamtContent } from './camt-parser.util';

/**
 * Banking service — owns CSV/CAMT.053 imports, CsvTemplate CRUD, list/filter
 * queries, and exports. All mutations emit a hash-chained AuditLog row.
 */
@Injectable()
export class BankingService {
  private readonly logger = new Logger(BankingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ============================================================ Templates

  async listTemplates(tenantId: string) {
    return this.prisma.csvTemplate.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getTemplate(tenantId: string, id: string) {
    const t = await this.prisma.csvTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!t) throw new NotFoundException('Template não encontrado');
    return t;
  }

  async createTemplate(
    tenantId: string,
    userId: string,
    dto: CreateCsvTemplateDto,
  ) {
    const existing = await this.prisma.csvTemplate.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException('Template com este nome já existe');
    }
    const created = await this.prisma.csvTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        mapping: dto.mapping as unknown as Prisma.InputJsonValue,
        dateFormat: dto.dateFormat ?? 'DD/MM/YYYY',
        decimalSep: dto.decimalSep ?? ',',
        thousandSep: dto.thousandSep ?? '.',
        hasHeader: dto.hasHeader !== false,
      },
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.CREATE,
      entityType: 'csv_template',
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  }

  async updateTemplate(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateCsvTemplateDto,
  ) {
    const t = await this.prisma.csvTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!t) throw new NotFoundException('Template não encontrado');

    const data: Prisma.CsvTemplateUpdateInput = {};
    if (dto.mapping !== undefined) {
      data.mapping = dto.mapping as unknown as Prisma.InputJsonValue;
    }
    if (dto.dateFormat !== undefined) data.dateFormat = dto.dateFormat;
    if (dto.decimalSep !== undefined) data.decimalSep = dto.decimalSep;
    if (dto.thousandSep !== undefined) data.thousandSep = dto.thousandSep;
    if (dto.hasHeader !== undefined) data.hasHeader = dto.hasHeader;

    const updated = await this.prisma.csvTemplate.update({
      where: { id },
      data,
    });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.EDIT,
      entityType: 'csv_template',
      entityId: id,
      metadata: { name: updated.name },
    });
    return updated;
  }

  async deleteTemplate(tenantId: string, userId: string, id: string) {
    const t = await this.prisma.csvTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!t) throw new NotFoundException('Template não encontrado');
    await this.prisma.csvTemplate.delete({ where: { id } });
    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.DELETE,
      entityType: 'csv_template',
      entityId: id,
      metadata: { name: t.name },
    });
    return { deleted: true };
  }

  // ============================================================ CSV preview

  /**
   * Wizard step 2: parse the uploaded CSV into normalized rows so the UI
   * can show the first 20 to the user before they commit the import.
   */
  previewCsv(content: string, dto: PreviewCsvDto) {
    const result = parseCsvContent(content, {
      mapping: dto.toEffectiveMapping(),
      dateFormat: dto.dateFormat,
      decimalSep: dto.decimalSep,
      thousandSep: dto.thousandSep,
      hasHeader: dto.hasHeader,
    });

    // If the parser couldn't resolve required columns, surface a 400 with the
    // same diagnostic list — the wizard uses these messages to highlight the
    // missing/wrong columns in the UI. Previously this was returned inside
    // `data.errors` with HTTP 200, which the wizard mishandled; a 400 makes
    // the failure obvious and keeps us out of the "internal server error"
    // path entirely.
    const mappingErrors = result.errors.filter(
      (e) =>
        e.includes('Coluna de') ||
        e.includes('É necessário mapear') ||
        e.includes('mapping em falta'),
    );
    if (mappingErrors.length > 0 && result.rows.length === 0) {
      throw new BadRequestException({
        message:
          'Não foi possível mapear o CSV — verifique as colunas indicadas',
        errors: mappingErrors,
      });
    }

    return {
      headers: result.headers,
      preview: result.rows.slice(0, 20).map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        description: r.description,
        amount: r.amount,
        balance: r.balance ?? null,
        reference: r.reference ?? null,
      })),
      totalRows: result.rows.length,
      errors: result.errors.slice(0, 10),
      hasMoreErrors: result.errors.length > 10,
    };
  }

  // ============================================================ CSV import

  /**
   * Wizard step 3: persist parsed rows. The flow is:
   *
   *  1. file-level dedup (sha256 of the raw file) — short-circuit same file
   *  2. row-level dedup via `BankTransaction.importHash` unique index
   *  3. optionally upsert the mapping as a CsvTemplate
   *  4. createMany inside a tx, then audit-log
   */
  async importCsv(
    tenantId: string,
    userId: string,
    content: string,
    dto: ImportCsvDto,
  ) {
    const fileHash = computeFileHash(content);

    // File-level dedup: never re-import the exact same file
    const fileLevelDup = await this.prisma.bankTransaction.findFirst({
      where: { tenantId, importHash: fileHash },
      select: { id: true },
    });
    if (fileLevelDup) {
      throw new ConflictException(
        'Este ficheiro já foi importado anteriormente (mesmo hash)',
      );
    }

    const parsed = parseCsvContent(content, {
      mapping: dto.toEffectiveMapping(),
      dateFormat: dto.dateFormat,
      decimalSep: dto.decimalSep,
      thousandSep: dto.thousandSep,
      hasHeader: dto.hasHeader,
    });

    // Same defensive guard as previewCsv — turn a missing/malformed mapping
    // into a 400 with a helpful message instead of letting the parser crash
    // with a TypeError deeper in the row loop (BUG 4).
    const mappingErrors = parsed.errors.filter(
      (e) =>
        e.includes('Coluna de') ||
        e.includes('É necessário mapear') ||
        e.includes('mapping em falta'),
    );
    if (mappingErrors.length > 0 && parsed.rows.length === 0) {
      throw new BadRequestException({
        message:
          'Não foi possível mapear o CSV — verifique as colunas indicadas',
        errors: mappingErrors,
      });
    }

    if (parsed.rows.length === 0) {
      throw new BadRequestException({
        message: 'Nenhuma linha válida encontrada no CSV',
        errors: parsed.errors,
      });
    }

    // Compute per-row hash for row-level dedup
    const rowsWithHash = parsed.rows.map((r) => ({
      row: r,
      rowHash: computeRowHash({
        date: r.date,
        description: r.description,
        amount: r.amount,
        reference: r.reference ?? null,
      }),
    }));

    // Find existing row hashes for this tenant to skip duplicates
    const existingHashes = new Set<string>();
    if (rowsWithHash.length > 0) {
      const existing = await this.prisma.bankTransaction.findMany({
        where: {
          tenantId,
          importHash: { in: rowsWithHash.map((r) => r.rowHash) },
        },
        select: { importHash: true },
      });
      existing.forEach((e) => existingHashes.add(e.importHash));
    }

    const unique = rowsWithHash.filter(
      (r) => !existingHashes.has(r.rowHash),
    );
    const skippedDuplicates = rowsWithHash.length - unique.length;

    // Optional: save mapping as template. Use the effective (folded) mapping
    // so the persisted template reflects the columns the parser actually
    // matched — a flat *Column request saves a nested mapping for next time.
    if (dto.saveAsTemplate) {
      const effectiveMapping = dto.toEffectiveMapping();
      await this.prisma.csvTemplate.upsert({
        where: {
          tenantId_name: { tenantId, name: dto.saveAsTemplate },
        },
        update: {
          mapping: effectiveMapping as unknown as Prisma.InputJsonValue,
          dateFormat: dto.dateFormat ?? 'DD/MM/YYYY',
          decimalSep: dto.decimalSep ?? ',',
          thousandSep: dto.thousandSep ?? '.',
          hasHeader: dto.hasHeader !== false,
        },
        create: {
          tenantId,
          name: dto.saveAsTemplate,
          mapping: effectiveMapping as unknown as Prisma.InputJsonValue,
          dateFormat: dto.dateFormat ?? 'DD/MM/YYYY',
          decimalSep: dto.decimalSep ?? ',',
          thousandSep: dto.thousandSep ?? '.',
          hasHeader: dto.hasHeader !== false,
        },
      });
    }

    const importBatch = `csv-${Date.now()}`;
    const data = unique.map(({ row, rowHash }) => ({
      tenantId,
      date: row.date,
      description: row.description,
      amount: row.amount,
      balance: row.balance ?? null,
      reference: row.reference ?? null,
      rawRowJson: row.raw as unknown as Prisma.InputJsonValue,
      importHash: rowHash,
      importBatch,
      source: 'CSV',
    }));

    let imported = 0;
    if (data.length > 0) {
      imported = await this.prisma.$transaction(async (tx) => {
        const res = await tx.bankTransaction.createMany({
          data,
          skipDuplicates: true,
        });
        await this.audit.logInTx(tx, {
          tenantId,
          userId: userId ?? undefined,
          action: AuditAction.IMPORT,
          entityType: 'bank_transaction',
          entityId: importBatch,
          metadata: {
            source: 'CSV',
            batch: importBatch,
            parsed: parsed.rows.length,
            imported: res.count,
            skippedDuplicates,
            parseErrors: parsed.errors.length,
            fileHash,
          },
        }, { swallow: true });
        return res.count;
      });
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.IMPORT,
      entityType: 'bank_transaction',
      metadata: {
        source: 'CSV',
        batch: importBatch,
        imported,
        skippedDuplicates,
      },
    });

    return {
      imported,
      skippedDuplicates,
      totalRows: parsed.rows.length,
      errors: parsed.errors.slice(0, 20),
      hasMoreErrors: parsed.errors.length > 20,
      importBatch,
    };
  }

  // ============================================================ CAMT.053

  /**
   * Import an ISO 20022 CAMT.053 bank statement. The XML is parsed into
   * entries, each entry becomes a BankTransaction with a per-row hash.
   */
  async importCamt(
    tenantId: string,
    userId: string,
    dto: ImportCamtDto,
  ) {
    if (!dto.xml || dto.xml.trim().length === 0) {
      throw new BadRequestException('XML CAMT.053 é obrigatório');
    }
    if (dto.xml.length > 5 * 1024 * 1024) {
      throw new BadRequestException('XML excede tamanho máximo (5MB)');
    }

    const entries = parseCamtContent(dto.xml);
    if (entries.length === 0) {
      throw new BadRequestException(
        'Nenhuma entrada <Ntry> encontrada no XML CAMT.053',
      );
    }

    const importBatch = `camt-${Date.now()}`;

    // Compute per-row hash and dedup
    const candidates = entries.map((e) => ({
      entry: e,
      rowHash: computeRowHash({
        date: new Date(e.date),
        description:
          e.remittanceInfo ??
          e.counterpartyName ??
          e.endToEndId ??
          e.txId ??
          'CAMT entry',
        amount: e.amount,
        reference: e.bankRef ?? e.endToEndId ?? e.txId ?? null,
      }),
    }));

    const existingHashes = new Set<string>();
    if (candidates.length > 0) {
      const existing = await this.prisma.bankTransaction.findMany({
        where: {
          tenantId,
          importHash: { in: candidates.map((c) => c.rowHash) },
        },
        select: { importHash: true },
      });
      existing.forEach((e) => existingHashes.add(e.importHash));
    }
    const unique = candidates.filter(
      (c) => !existingHashes.has(c.rowHash),
    );
    const skippedDuplicates = candidates.length - unique.length;

    const data = unique.map(({ entry, rowHash }) => ({
      tenantId,
      date: new Date(entry.date),
      description:
        entry.remittanceInfo ??
        entry.counterpartyName ??
        entry.endToEndId ??
        entry.txId ??
        'CAMT entry',
      amount: entry.amount,
      balance: null,
      reference:
        entry.bankRef ?? entry.endToEndId ?? entry.txId ?? null,
      counterpartyName: entry.counterpartyName ?? null,
      counterpartyIban: entry.counterpartyIban ?? null,
      rawRowJson: {
        direction: entry.direction,
        currency: entry.currency,
        rawXml: entry.rawXml,
      } as unknown as Prisma.InputJsonValue,
      importHash: rowHash,
      importBatch,
      source: 'CAMT.053',
    }));

    let imported = 0;
    if (data.length > 0) {
      imported = await this.prisma.$transaction(async (tx) => {
        const res = await tx.bankTransaction.createMany({
          data,
          skipDuplicates: true,
        });
        await this.audit.logInTx(tx, {
          tenantId,
          userId: userId ?? undefined,
          action: AuditAction.IMPORT,
          entityType: 'bank_transaction',
          entityId: importBatch,
          metadata: {
            source: 'CAMT.053',
            batch: importBatch,
            parsed: entries.length,
            imported: res.count,
            skippedDuplicates,
            label: dto.batchLabel ?? null,
          },
        }, { swallow: true });
        return res.count;
      });
    }

    await this.audit.log({
      tenantId,
      userId,
      action: AuditAction.IMPORT,
      entityType: 'bank_transaction',
      metadata: {
        source: 'CAMT.053',
        batch: importBatch,
        imported,
        skippedDuplicates,
        label: dto.batchLabel ?? null,
      },
    });

    return {
      imported,
      skippedDuplicates,
      totalEntries: entries.length,
      importBatch,
    };
  }

  // ============================================================ List / get

  /**
   * Paginated transaction listing with optional date range, free-text
   * search on description/ref, and source filter.
   */
  async listTransactions(tenantId: string, query: BankTransactionQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Prisma.BankTransactionWhereInput = { tenantId };
    if (query.from || query.to) {
      where.date = {};
      if (query.from) where.date.gte = new Date(query.from);
      if (query.to) {
        const to = new Date(query.to);
        to.setHours(23, 59, 59, 999);
        where.date.lte = to;
      }
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        {
          counterpartyName: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      ];
    }
    if (query.source) {
      where.source = query.source;
    }

    const [items, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        date: t.date,
        description: t.description,
        amount: Number(t.amount),
        balance: t.balance != null ? Number(t.balance) : null,
        reference: t.reference,
        counterpartyName: t.counterpartyName,
        counterpartyIban: t.counterpartyIban,
        importBatch: t.importBatch,
        source: t.source,
        importHash: t.importHash,
        reconciledAt: t.reconciledAt,
        createdAt: t.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTransaction(tenantId: string, id: string) {
    const t = await this.prisma.bankTransaction.findFirst({
      where: { id, tenantId },
    });
    if (!t) throw new NotFoundException('Transação não encontrada');
    return {
      ...t,
      amount: Number(t.amount),
      balance: t.balance != null ? Number(t.balance) : null,
    };
  }

  // ============================================================ Export

  /**
   * Build a CSV (Excel-compatible) export honoring the same filters as
   * the list endpoint. Capped at 10k rows to keep memory bounded.
   */
  async exportTransactionsCsv(
    tenantId: string,
    query: BankTransactionQueryDto,
  ): Promise<string> {
    const where: Prisma.BankTransactionWhereInput = { tenantId };
    if (query.from || query.to) {
      where.date = {};
      if (query.from) where.date.gte = new Date(query.from);
      if (query.to) {
        const to = new Date(query.to);
        to.setHours(23, 59, 59, 999);
        where.date.lte = to;
      }
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.source) {
      where.source = query.source;
    }

    const items = await this.prisma.bankTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 10000,
    });

    const escape = (val: unknown): string => {
      if (val == null) return '';
      const s = String(val);
      if (s.includes('"') || s.includes(';') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const formatDate = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${dd}/${mm}/${yyyy}`;
    };
    const formatAmount = (n: unknown): string => {
      const num = typeof n === 'string' ? parseFloat(n) : (n as number);
      if (isNaN(num)) return '';
      return num.toFixed(2).replace('.', ',');
    };

    const headers = [
      'ID',
      'Data',
      'Descrição',
      'Valor',
      'Saldo',
      'Referência',
      'Contraparte',
      'Origem',
      'Lote',
      'Importado em',
    ];
    const rows = items.map((t) => [
      t.id,
      formatDate(t.date),
      t.description,
      formatAmount(t.amount),
      formatAmount(t.balance != null ? Number(t.balance) : null),
      t.reference ?? '',
      t.counterpartyName ?? '',
      t.source ?? '',
      t.importBatch ?? '',
      formatDate(t.createdAt),
    ]);

    const lines = [headers, ...rows].map((row) =>
      row.map(escape).join(';'),
    );
    // BOM so Excel auto-detects UTF-8
    return '﻿' + lines.join('\r\n');
  }
}