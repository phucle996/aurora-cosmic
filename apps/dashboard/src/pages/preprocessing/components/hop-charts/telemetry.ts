export type Telemetry = Record<string, Array<{ timestamp: number; value: number }>>;

export function mergedSeries(telemetry: Telemetry | undefined, keys: string[]): Array<Record<string, number>> {
  const rows = new Map<number, Record<string, number>>();
  for (const key of keys) {
    for (const point of telemetry?.[key] ?? []) {
      const timestamp = Number(point.timestamp);
      const row = rows.get(timestamp) ?? { timestamp };
      row[key] = Number(point.value);
      rows.set(timestamp, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function clock(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
