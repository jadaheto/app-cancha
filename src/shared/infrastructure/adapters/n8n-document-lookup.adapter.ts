import { Injectable, Logger } from '@nestjs/common';
import { AppEnv, loadEnv } from '../../config/env';
import { DocumentLookupPort, DocumentLookupResult } from '../../domain/ports/document-lookup.port';
import { UserCategory } from '../../domain/value-objects/user-category';
import { describeFetchError } from './n8n-phone-verification.adapter';

const VALID = new Set<string>(['A', 'B', 'C', 'D']);

/**
 * Consulta de la categoría del afiliado en el webhook de afiliados de n8n
 * (el mismo que usa CLARA, port de N8n_affiliates_service::lookup_beneficiary_category):
 * POST application/x-www-form-urlencoded { numero_identificacion } + Authorization Basic.
 *
 * n8n devuelve un registro por cada relación con un afiliado; se toma la categoría
 * del afiliado ACTIVO. Si el documento no es afiliado, no hay categoría válida o n8n
 * no responde, se cobra como particular (categoría D). Nunca lanza.
 */
@Injectable()
export class N8nDocumentLookupAdapter implements DocumentLookupPort {
  private readonly logger = new Logger(N8nDocumentLookupAdapter.name);
  private readonly cfg: AppEnv['affiliateLookup'];

  constructor() {
    this.cfg = loadEnv().affiliateLookup;
  }

  async lookup(documentNumber: string): Promise<DocumentLookupResult> {
    const doc = (documentNumber ?? '').replace(/\D/g, '');
    const particular: DocumentLookupResult = { found: false, category: UserCategory.D };
    if (!this.cfg.url) {
      this.logger.warn('Consulta de afiliados no configurada (AFFILIATE_LOOKUP_URL): se cobra como categoría D.');
      return particular;
    }
    if (!doc) return particular;

    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (this.cfg.authorization) headers.Authorization = this.cfg.authorization;
    try {
      const response = await fetch(this.cfg.url, {
        method: 'POST',
        headers,
        body: new URLSearchParams({ numero_identificacion: doc }).toString(),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      const body = await response.text();
      const result = parseAffiliateLookup(response.status, body);
      if (result === null) {
        this.logger.warn(`Afiliados: respuesta no válida para ${mask(doc)} (HTTP ${response.status}): ${body.slice(0, 300)}`);
        return particular;
      }
      this.logger.log(`Afiliados: ${mask(doc)} → categoría ${result.category}${result.found ? '' : ' (no afiliado activo)'}`);
      return result;
    } catch (error) {
      this.logger.warn(`Afiliados: sin respuesta del webhook para ${mask(doc)}: ${describeFetchError(error)}. Se cobra como categoría D.`);
      return particular;
    }
  }
}

/**
 * Interpreta la respuesta del webhook de afiliados. `null` = respuesta inválida.
 * Prioriza el registro con estado_vs_afiliado = ACTIVO; si ninguno tiene una
 * categoría válida (A–D), devuelve D (no encontrado).
 */
export function parseAffiliateLookup(status: number, body: string): DocumentLookupResult | null {
  if (status >= 400) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return null;
  }
  if (decoded === null || typeof decoded !== 'object') return null;
  const rows: unknown[] = Array.isArray(decoded) ? decoded : Object.values(decoded as Record<string, unknown>);
  let best: string | null = null;
  let fallback: string | null = null;
  let bestRow: Record<string, unknown> | null = null;
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const cat = String(row['categoria'] ?? '').trim().toUpperCase();
    if (!VALID.has(cat)) continue;
    const estado = String(row['estado_vs_afiliado'] ?? '').trim().toUpperCase();
    if (estado === 'ACTIVO' && best === null) { best = cat; bestRow = row; }
    else if (fallback === null) { fallback = cat; bestRow ??= row; }
  }
  const category = (best ?? fallback ?? 'D') as UserCategory;
  const name = String(bestRow?.['nombre'] ?? bestRow?.['nombre_completo'] ?? '').trim() || undefined;
  return { found: category !== UserCategory.D, category, name };
}

function mask(doc: string): string {
  return doc.length > 4 ? `${'*'.repeat(doc.length - 4)}${doc.slice(-4)}` : doc;
}
