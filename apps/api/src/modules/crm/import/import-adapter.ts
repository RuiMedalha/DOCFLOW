import { Logger } from '@nestjs/common';

/**
 * Source CRM identifiers supported by the import pipeline. Each one has a
 * dedicated adapter that knows its native field names and quirks.
 */
export type ImportSource = 'hubspot' | 'pipedrive';

/**
 * A single row from the source CRM, normalised to the adapter's common
 * shape. The mapping step later projects these to DocFlow columns.
 */
export interface AdapterRow {
  externalId: string;
  rawFields: Record<string, unknown>;
}

/**
 * Adapter contract. The two real implementations (`HubSpotAdapter`,
 * `PipedriveAdapter`) are STUBS today — they return canned rows so the
 * import pipeline, mapping, and audit-log path can be exercised end-to-end
 * without real OAuth credentials. Swapping in live HTTP calls is a
 * straight find-and-replace: the public surface (`fetchRows`) stays the
 * same.
 */
export interface ImportAdapter {
  readonly source: ImportSource;

  /**
   * Pull a batch of rows from the source CRM. `cursor` is opaque to the
   * caller — the adapter uses it for pagination.
   */
  fetchRows(opts: {
    apiKey?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ rows: AdapterRow[]; nextCursor: string | null }>;
}

/**
 * HubSpot adapter (mock mode). Returns a small canned dataset shaped like
 * what HubSpot's `/crm/v3/objects/companies` would return. The caller can
 * still pass an explicit `rows` payload via the controller — this adapter
 * is the *fallback* path the import endpoint hits when the caller did not
 * attach a row list.
 */
export class HubSpotAdapter implements ImportAdapter {
  readonly source: ImportSource = 'hubspot';
  private readonly logger = new Logger(HubSpotAdapter.name);

  async fetchRows(opts: { cursor?: string; limit?: number; apiKey?: string }): Promise<{
    rows: AdapterRow[];
    nextCursor: string | null;
  }> {
    this.logger.warn(
      `HubSpotAdapter running in MOCK mode (apiKey=${opts.apiKey ? 'set' : 'unset'}). ` +
        'No live HTTP calls. Replace this with the real HubSpot Client.',
    );
    const limit = Math.min(opts.limit ?? 100, 1000);
    const canned: AdapterRow[] = [
      {
        externalId: 'hs-1001',
        rawFields: {
          company: 'Tasca do Chico, Lda',
          vat_number: '509123456',
          email_address: 'geral@tasca-chico.pt',
          phone: '+351 210 555 111',
          city: 'Porto',
          country: 'Portugal',
          industry: 'Restauração',
        },
      },
      {
        externalId: 'hs-1002',
        rawFields: {
          company: 'Papelaria Central',
          vat_number: '502987654',
          email_address: 'compras@papelaria-central.pt',
          phone: '+351 213 555 222',
          city: 'Lisboa',
          country: 'Portugal',
          industry: 'Retalho',
        },
      },
    ];
    return {
      rows: canned.slice(0, limit),
      nextCursor: null,
    };
  }
}

/**
 * Pipedrive adapter (mock mode). Returns a small canned dataset shaped
 * like what Pipedrive's `/v1/organizations` would return.
 */
export class PipedriveAdapter implements ImportAdapter {
  readonly source: ImportSource = 'pipedrive';
  private readonly logger = new Logger(PipedriveAdapter.name);

  async fetchRows(opts: { cursor?: string; limit?: number; apiKey?: string }): Promise<{
    rows: AdapterRow[];
    nextCursor: string | null;
  }> {
    this.logger.warn(
      `PipedriveAdapter running in MOCK mode (apiKey=${opts.apiKey ? 'set' : 'unset'}). ` +
        'No live HTTP calls. Replace this with the real Pipedrive Client.',
    );
    const limit = Math.min(opts.limit ?? 100, 1000);
    const canned: AdapterRow[] = [
      {
        externalId: 'pd-7700',
        rawFields: {
          name: 'Clínica São Bento',
          vat: '504321987',
          email: [{ value: 'atendimento@clinicasb.pt', primary: true }],
          phone: [{ value: '+351 222 333 444', primary: true }],
          address_city: 'Coimbra',
          address_country: 'Portugal',
        },
      },
    ];
    return {
      rows: canned.slice(0, limit),
      nextCursor: null,
    };
  }
}

/**
 * Resolve an adapter for a given source. The two adapters above are
 * stateless and registered here; adding a new source means adding it to
 * this map and creating the adapter class.
 */
export function adapterFor(source: ImportSource): ImportAdapter {
  switch (source) {
    case 'hubspot':
      return new HubSpotAdapter();
    case 'pipedrive':
      return new PipedriveAdapter();
    default: {
      // Exhaustiveness — TS will complain if a new source is added without
      // a case here.
      const _exhaustive: never = source;
      throw new Error(`Unsupported import source: ${String(source)}`);
    }
  }
}