import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PartyType } from "@prisma/client";
import { isValidNif, normalizeNif, normalizeIban } from "@docflow/shared";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Inputs the extractor feeds into the supplier auto-resolve step.
 * All fields are optional — the helper is defensive about missing data.
 */
export interface SupplierResolveInput {
  /** Tenant scoping — every query MUST carry this. */
  tenantId: string;
  /** ISO 3166-1 alpha-2 country the supplier operates in (PT for Portuguese suppliers). */
  country?: string;
  /** Supplier display name as extracted (may be undefined). */
  supplierName?: string;
  /** Portuguese NIF (9 digits, mod-11 valid). */
  supplierNif?: string;
  /** Country-prefixed VAT ID for foreign suppliers (e.g. "FR12345678901"). */
  supplierVatId?: string;
  /** IBAN from the document. Carried into the Party row when we create one. */
  iban?: string;
  /** AI-reported confidence (0..1). Below 0.8 → supplierReview = true. */
  aiConfidence?: number;
}

/**
 * Result the helper hands back to processDocumentAsync. The Document row
 * is updated with `document.partyId` + `metadata.supplierReview` based on
 * these fields. `party` is the Prisma row the helper decided on (used by
 * downstream code to decide whether to fire the recurring threshold).
 */
export interface SupplierResolveResult {
  /** Resolved Party row (existing or newly created). null on failure. */
  party: { id: string; isRecurring: boolean } | null;
  /**
   * Whether the document needs the user to confirm the supplier.
   * True when the AI confidence was low (< 0.8) OR the NIF/VAT was
   * invalid. The UI surfaces this as a "needs review" badge.
   */
  supplierReview: boolean;
  /** Free-form reason for the audit trail / metadata. */
  reason: string;
}

/**
 * SupplierResolver — auto-links (or creates + links) the Party record
 * for an extracted supplier.
 *
 * Rules (user-approved, see docs/FOREIGN_INVOICE_FLOW.md):
 *   - Every supplier gets a Party record (always created if missing).
 *   - Look up by (tenantId, nif OR vatId, country). When the country is
 *     missing we fall back to a tenantId+nif lookup; foreign VATs are
 *     inherently country-prefixed so country is always present there.
 *   - Confidence gate: aiConfidence > 0.8 AND the NIF/VAT validates
 *     (PT NIF mod-11, EU VAT shape) → create + link silently. Below
 *     that threshold → still create the Party but flag
 *     supplierReview on the document metadata so the UI can prompt the
 *     user to confirm.
 *   - Recurring flag: when the supplier already has >= 3 documents
 *     linked, flip `isRecurring = true`. Read-then-write is fine here
 *     because two parallel uploads of the same supplier may both
 *     bump the flag — set is idempotent at the column level.
 *   - NEVER blocks / crashes the upload. All DB errors are caught,
 *     logged, and converted to `{ party: null, supplierReview: true }`
 *     so the document row + extraction metadata still get written.
 *
 * Kept separate from extraction.service.ts so:
 *   1) the unit tests can exercise it without spinning up the full
 *      extraction pipeline, and
 *   2) folder-rules work (in a parallel pane) reads its result without
 *      a circular import on the main service.
 */
@Injectable()
export class SupplierResolver {
  private readonly logger = new Logger(SupplierResolver.name);

  /** Threshold of documents a supplier needs to be flagged recurring. */
  static readonly RECURRING_THRESHOLD = 3;
  /** Confidence floor — below this, supplierReview is set. */
  static readonly CONFIDENCE_FLOOR = 0.8;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve + link the supplier for a Document extraction.
   * Always returns a result; failure paths return null party + review=true.
   *
   * The `pendingDocument` argument tells the resolver that the caller
   * (processDocumentAsync) WILL create one more Document row linked to
   * the resolved party in the same flow. We use it to bump the recurring
   * threshold against the count *after* the link, not before — so the
   * third upload crossing the threshold actually flips isRecurring on
   * its own resolution.
   */
  async resolve(input: SupplierResolveInput): Promise<SupplierResolveResult> {
    const { tenantId, country, supplierName, supplierNif, supplierVatId, iban, aiConfidence } = input;

    try {
      const normalizedNif = supplierNif ? normalizeNif(supplierNif) : "";
      // Country-prefixed VAT (e.g. "FR123...") wins over a bare NIF when
      // both are present — foreign invoices carry the VAT on the row.
      const normalizedVat = supplierVatId
        ? supplierVatId.replace(/\s+/g, "").toUpperCase()
        : "";
      const countryCode = (country || (normalizedVat ? normalizedVat.slice(0, 2) : "PT")).toUpperCase();

      const taxIdValid = this.isTaxIdValid(countryCode, normalizedNif, normalizedVat);

      // Foreign VATs are stored in the `nif` column with their country
      // prefix so future lookups can match on (nif + country). PT NIFs
      // are stored as the bare 9-digit string.
      const taxIdToStore =
        countryCode === "PT"
          ? taxIdValid
            ? normalizedNif
            : null
          : normalizedVat || null;

      // Look up by NIF (PT) OR VAT (foreign). Tenant scoping is mandatory.
      const existing = await this.lookupParty({
        tenantId,
        nif: normalizedNif || null,
        vatId: normalizedVat || null,
        country: countryCode,
      });

      const confidenceOk = (aiConfidence ?? 0) > SupplierResolver.CONFIDENCE_FLOOR;
      // PT NIFs are validated with mod-11; foreign VATs use shape rules
      // (`findForeignVatId` in extraction.service.ts already vetted them,
      // but we re-check so the helper is safe to call directly).
      const supplierReview = !(confidenceOk && taxIdValid);

      let partyRow: { id: string; isRecurring: boolean; name: string; nif: string | null } | null = existing;

      if (!partyRow) {
        // Create the Party row. The validators in PartiesService would
        // throw on bad NIFs/IBANs, so we pick what we can store and let
        // the rest pass as null — the supplierReview flag covers the gap.
        const ibanToStore = iban && this.isIbanValid(iban) ? normalizeIban(iban) : null;
        const nameToStore = supplierName?.trim()?.slice(0, 200) || "Fornecedor por identificar";

        try {
          partyRow = await this.prisma.party.create({
            data: {
              tenantId,
              type: PartyType.FORNECEDOR,
              name: nameToStore,
              nif: taxIdToStore,
              iban: ibanToStore,
              country: countryCode,
              isActive: true,
            },
            select: { id: true, name: true, nif: true, isRecurring: true },
          });
        } catch (err) {
          // Race with a parallel upload that just created the same row —
          // re-read by tax-id + tenant and use that one. Anything else
          // is a hard failure → log + return null party so the caller
          // proceeds without linking.
          const raced = await this.lookupParty({
            tenantId,
            nif: countryCode === "PT" ? taxIdToStore : null,
            vatId: countryCode !== "PT" ? normalizedVat : null,
            country: countryCode,
          });
          if (raced) {
            partyRow = raced;
          } else {
            this.logger.warn(
              `[resolve] could not create party for tenant=${tenantId} ` +
                `vat=${normalizedVat} nif=${normalizedNif}: ${(err as Error).message}`,
            );
            return {
              party: null,
              supplierReview: true,
              reason: `party_create_failed:${(err as Error).message?.slice(0, 120)}`,
            };
          }
        }
      }

      // Recurring threshold — read tenant's documents for this party,
      // bump isRecurring when count crosses the floor. We add `+1`
      // because the caller WILL create one more Document row linked to
      // this party in the same flow (the resolution runs BEFORE the
      // Document write). Cheap because the (tenantId, partyId) index on
      // documents makes this a bounded scan.
      const isRecurring = await this.refreshRecurringFlag(tenantId, partyRow.id, 1);

      return {
        party: { id: partyRow.id, isRecurring },
        supplierReview,
        reason: existing ? "found" : supplierReview ? "created_review" : "created",
      };
    } catch (err) {
      // Never let the supplier step abort extraction. Log + degrade to
      // null party + review=true; the document row is still saved.
      this.logger.warn(
        `[resolve] unexpected failure for tenant=${input.tenantId}: ${(err as Error).message}`,
      );
      this.logger.debug(`[resolve] stack: ${(err as Error).stack ?? "(none)"}`);
      return {
        party: null,
        supplierReview: true,
        reason: `resolve_threw:${(err as Error).message?.slice(0, 120)}`,
      };
    }
  }

  /**
   * Look up a Party by tenantId + (nif OR vatId, country). Returns null
   * when nothing matches. Country matching is required for VAT-based
   * lookups (a PT NIF won't collide with a FR VAT), optional for
   * PT NIFs (we treat the country as PT).
   */
  private async lookupParty(args: {
    tenantId: string;
    nif: string | null;
    vatId: string | null;
    country: string;
  }): Promise<{ id: string; name: string; nif: string | null; isRecurring: boolean } | null> {
    const { tenantId, nif, vatId, country } = args;

    // Prefer NIF lookup (most common in PT).
    if (nif) {
      const byNif = await this.prisma.party.findFirst({
        where: { tenantId, nif },
        select: { id: true, name: true, nif: true, isRecurring: true },
      });
      if (byNif) return byNif;
    }

    // Fall back to VAT — store the country-prefixed VAT as the `nif`
    // column for foreign suppliers (the schema doesn't have a dedicated
    // vatId column; the leading 2-letter prefix lets us reconstruct it).
    if (vatId && vatId.slice(0, 2) === country) {
      const byVat = await this.prisma.party.findFirst({
        where: { tenantId, nif: vatId, country },
        select: { id: true, name: true, nif: true, isRecurring: true },
      });
      if (byVat) return byVat;
    }

    // Final fallback: search by country + partial VAT prefix (covers the
    // case where the row was stored without the country-prefix normalization).
    if (vatId && vatId.length >= 4) {
      const byPrefix = await this.prisma.party.findFirst({
        where: { tenantId, country, nif: { contains: vatId.slice(2) } },
        select: { id: true, name: true, nif: true, isRecurring: true },
      });
      if (byPrefix) return byPrefix;
    }

    return null;
  }

  /**
   * Refresh the recurring flag based on the supplier's document count.
   * `pendingDocuments` is the number of documents the caller is about to
   * write in the same flow — included in the threshold check so the
   * third upload crossing the threshold flips the flag on its own call.
   * Idempotent — flipping a true → true write is a no-op.
   */
  private async refreshRecurringFlag(
    tenantId: string,
    partyId: string,
    pendingDocuments = 0,
  ): Promise<boolean> {
    try {
      // Respect ADMIN manual override: if the party is locked, do NOT flip
      // isRecurring automatically — return the locked value as-is.
      const party = await this.prisma.party.findFirst({
        where: { id: partyId },
        select: { isRecurringManualOverride: true, isRecurring: true },
      });
      if (party?.isRecurringManualOverride === true) {
        return party.isRecurring;
      }

      const docCount = await this.prisma.document.count({
        where: { tenantId, partyId },
      });
      const shouldRecur =
        docCount + pendingDocuments >= SupplierResolver.RECURRING_THRESHOLD;
      if (shouldRecur) {
        await this.prisma.party.update({
          where: { id: partyId },
          data: { isRecurring: true },
        });
      }
      return shouldRecur;
    } catch (err) {
      this.logger.warn(
        `[resolve] could not refresh isRecurring for party=${partyId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Validate a tax ID based on the issuing country. PT uses mod-11
   * via the shared util; foreign VATs use the same VIES shape regex
   * extraction.service.ts already vetted.
   */
  private isTaxIdValid(country: string, nif: string, vatId: string): boolean {
    if (country === "PT") {
      return !!nif && isValidNif(nif);
    }
    if (vatId) {
      // Reuse the same VIES shape regex from extraction.service.ts via
      // a tiny inline copy — keeps this helper self-contained and the
      // behaviour identical to the extraction step's check.
      return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(vatId) && this.viesShapeMatches(vatId);
    }
    return false;
  }

  /** Same regex table as `findForeignVatId` in extraction.service.ts. */
  private viesShapeMatches(vatId: string): boolean {
    const patterns: Record<string, RegExp> = {
      AT: /^ATU\d{8}$/,
      BE: /^BE\d{10}$/,
      BG: /^BG\d{9,10}$/,
      CY: /^CY\d{8}[A-Z]$/,
      CZ: /^CZ\d{8,10}$/,
      DE: /^DE\d{9}$/,
      DK: /^DK\d{8}$/,
      EE: /^EE\d{9}$/,
      ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
      FI: /^FI\d{8}$/,
      FR: /^FR[A-Z0-9]{2}\d{9}$/,
      GR: /^(?:GR|EL)\d{9}$/,
      HR: /^HR\d{11}$/,
      HU: /^HU\d{8}$/,
      IE: /^IE\d{7}[A-Z0-9]{1,2}$/,
      IT: /^IT\d{11}$/,
      LT: /^LT(?:\d{9}|\d{12})$/,
      LU: /^LU\d{8}$/,
      LV: /^LV\d{11}$/,
      MT: /^MT\d{8}$/,
      NL: /^NL\d{9}B\d{2}$/,
      PL: /^PL\d{10}$/,
      RO: /^RO\d{2,10}$/,
      SE: /^SE\d{12}$/,
      SI: /^SI\d{8}$/,
      SK: /^SK\d{10}$/,
      GB: /^GB(?:\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
    };
    const country = vatId.slice(0, 2) === "EL" ? "GR" : vatId.slice(0, 2);
    return patterns[country]?.test(vatId) ?? false;
  }

  private isIbanValid(iban: string): boolean {
    try {
      // normalizeIban strips separators; the strict validator is the
      // MOD-97 check. Don't import the whole shared package here for
      // one symbol — call it via the extraction service's already-imported
      // helpers via the PrismaService caller. Keep this defensive so a
      // malformed IBAN never blocks the Party row.
      const cleaned = iban.replace(/\s+/g, "").toUpperCase();
      // Cheap shape check first; full MOD-97 below.
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(cleaned)) return false;
      // Re-arrange: move first 4 chars to the end + replace letters.
      const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
      let numeric = "";
      for (const ch of rearranged) {
        if (ch >= "A" && ch <= "Z") numeric += String(ch.charCodeAt(0) - 55);
        else numeric += ch;
      }
      // MOD-97: the big number must be ≡ 1 (mod 97).
      let remainder = 0;
      for (const ch of numeric) {
        remainder = (remainder * 10 + Number(ch)) % 97;
      }
      return remainder === 1;
    } catch {
      return false;
    }
  }
}

/** Re-export the Prisma namespace so the extraction module can build its own types if needed. */
export { Prisma };