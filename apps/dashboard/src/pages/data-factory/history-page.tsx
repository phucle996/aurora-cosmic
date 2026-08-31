import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Activity, AlertCircle, Clock3, Database, Layers3 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import type { FactoryRun } from './history-types';

function displayTime(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

export default function DataFactoryHistoryPage(): JSX.Element {
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?pipeline=silver_to_gold&limit=100');
      setRuns(response.items);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử Data Factory');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <div className="space-y-6">
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"><Clock3 className="size-4 text-primary" /> Durable operational ledger</div><h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Data Factory History</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Các run Silver → Gold do Gold Builder quan sát và ghi trực tiếp vào ClickHouse. Không có bản ghi suy diễn.</p></div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? 'Đang tải…' : 'Làm mới'}</Button>
    </div>
    {error && <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div>}
    <div className="grid gap-3 sm:grid-cols-3"><Summary icon={Activity} label="Observed runs" value={runs.length.toLocaleString()} /><Summary icon={Layers3} label="Completed batches" value={runs.reduce((sum, run) => sum + run.completed_batches, 0).toLocaleString()} /><Summary icon={Database} label="Indexed Gold rows" value={runs.reduce((sum, run) => sum + run.indexed_rows, 0).toLocaleString()} /></div>
    <Card><CardHeader><CardTitle>Run ledger</CardTitle><CardDescription>Chọn một run để mở DAG tại đúng snapshot lịch sử của run đó.</CardDescription></CardHeader><CardContent>{!loading && runs.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Chưa có run Gold nào được quan sát. Bản ghi chỉ xuất hiện sau khi Gold Builder thực sự chạy.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Run</th><th className="p-3">Mode / state</th><th className="p-3">Started</th><th className="p-3 text-right">Batches</th><th className="p-3 text-right">Silver in</th><th className="p-3 text-right">Gold rows</th><th className="p-3 text-right">Index</th><th className="p-3" /></tr></thead><tbody>{runs.map((run) => <tr key={run.run_id} className="border-b border-border/60 hover:bg-muted/30"><td className="p-3 font-mono text-xs text-primary">{run.run_id}</td><td className="p-3"><span className="rounded bg-muted px-2 py-1 text-xs uppercase">{run.mode}</span> <span className="text-xs text-muted-foreground">{run.status}</span></td><td className="p-3 text-xs text-muted-foreground">{displayTime(run.started_at)}</td><td className="p-3 text-right tabular-nums">{run.completed_batches}</td><td className="p-3 text-right tabular-nums">{run.input_records.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{run.output_rows.toLocaleString()}</td><td className="p-3 text-right tabular-nums">{run.indexed_rows.toLocaleString()}</td><td className="p-3 text-right"><Button asChild size="sm" variant="outline"><Link to={`/data-factory/pipeline?run_id=${encodeURIComponent(run.run_id)}`}>Phân tích DAG</Link></Button></td></tr>)}</tbody></table></div>}</CardContent></Card>
  </div>;
}

function Summary({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }): JSX.Element {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="flex items-center gap-2 text-lg"><Icon className="size-4 text-primary" />{value}</CardTitle></CardHeader></Card>;
}
