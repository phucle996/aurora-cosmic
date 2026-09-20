/**
 * @file utils.ts
 * @description Date formatting and status normalization utilities for runner tickets.
 */

export function parseTime(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function displayTime(value?: string): string {
  return parseTime(value)?.toLocaleString('en-US') ?? value ?? '—';
}

export function elapsed(start?: string, end?: string): string {
  const from = parseTime(start)?.getTime();
  const to = parseTime(end)?.getTime();
  if (from === undefined || to === undefined || to < from) return '—';
  const seconds = (to - from) / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function normalizedStatus(value?: string): string {
  return (value ?? 'not_observed').trim().toLowerCase();
}
