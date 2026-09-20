/**
 * @file utils.ts
 * @description Formatting utilities and stage evaluation logic for Lineage Explorer.
 */

import type { LineageRecord, StageFilter } from './types';

/**
 * Strips surrounding quotes from S3/MinIO ETags for clean display.
 * @param value Raw ETag string from MinIO/S3 (e.g. "\"a1b2c3...\"")
 * @returns Clean unquoted string, or em-dash if missing.
 */
export function cleanETag(value?: string): string {
  if (!value) return '—';
  return value.replaceAll('"', '');
}

/**
 * Formats a byte number into human-readable binary prefixes (B, KiB, MiB, GiB).
 * @param bytes Number of bytes in storage
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

/**
 * Formats an ISO date string into standard localized representation.
 * @param value ISO-8601 date string
 */
export function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US');
}

/**
 * Shortens a long string (e.g. SHA-256 hash or object key) with an ellipsis.
 * @param value The string to truncate
 * @param length Maximum allowed visible characters before truncation
 */
export function short(value?: string, length = 12): string {
  if (!value) return '—';
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

/**
 * Determines the highest resolved maturity stage for a given LineageRecord.
 *
 * Evaluation hierarchy:
 *  1. Gold: The product has been extracted and incorporated into a verified Gold manifest.
 *  2. Silver: A Parquet artifact exists in silver prefix.
 *  3. Bronze: Only raw FITS file is present; processing has not yet occurred.
 *
 * @param record Lineage record to evaluate
 * @returns 'gold' | 'silver' | 'bronze'
 */
export function recordStage(record: LineageRecord): Exclude<StageFilter, 'all'> {
  if (record.gold?.status === 'EXTRACTED') return 'gold';
  if (record.silver) return 'silver';
  return 'bronze';
}
