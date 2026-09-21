import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Activity, FileText, Sparkles, TableProperties, Telescope } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StorageFITSPreview } from '../../lakehouse/types';

interface FitsSectionProps {
  fits: StorageFITSPreview;
}

function formatTableCell(val: any, type?: string): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString();
    if (type === 'float64') return val.toFixed(5);
    return val.toFixed(3);
  }
  return String(val);
}

export function FitsSection({ fits }: FitsSectionProps): JSX.Element {
  const [activeHduIndex, setActiveHduIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('cards');
  const [fitsFilter, setFitsFilter] = useState('');
  const [tableFilter, setTableFilter] = useState('');

  const activeHDU = fits.hdus?.[activeHduIndex];

  // Auto-switch viewMode when user selects an HDU with a table
  useEffect(() => {
    if (activeHDU?.table) {
      setViewMode('table');
    } else {
      setViewMode('cards');
    }
  }, [activeHduIndex, activeHDU?.table]);

  const filteredFitsCards = useMemo(() => {
    if (!activeHDU) return [];
    if (!fitsFilter.trim()) return activeHDU.cards;
    const q = fitsFilter.toLowerCase().trim();
    return activeHDU.cards.filter(
      (c) =>
        c.keyword.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q) ||
        c.comment.toLowerCase().includes(q)
    );
  }, [activeHDU, fitsFilter]);

  const filteredTableRows = useMemo(() => {
    if (!activeHDU?.table?.rows) return [];
    if (!tableFilter.trim()) return activeHDU.table.rows;
    const q = tableFilter.toLowerCase().trim();
    return activeHDU.table.rows.filter((row) =>
      Object.entries(row).some(([k, v]) =>
        String(k).toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
      )
    );
  }, [activeHDU?.table?.rows, tableFilter]);

  const chartData = activeHDU?.table?.chart ?? [];

  return (
    <div className="space-y-6">
      {/* HDU Selection Tabs */}
      <Tabs
        value={String(activeHduIndex)}
        onValueChange={(val) => setActiveHduIndex(Number(val))}
        className="w-full"
      >
        <TabsList className="bg-muted/40 p-1 rounded-none border border-border/60 flex-wrap h-auto">
          {fits.hdus.map((hdu) => (
            <TabsTrigger
              key={hdu.index}
              value={String(hdu.index)}
              className="font-mono text-xs rounded-none gap-1.5 data-[state=active]:bg-background data-[state=active]:text-primary"
            >
              <Telescope className="size-3.5" />
              {hdu.name} ({hdu.type})
              {hdu.table && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] rounded-none font-mono">
                  {hdu.table.total_rows.toLocaleString()} rows
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Scientific Observation Metadata Context */}
      {activeHDU && Object.keys(activeHDU.summary).length > 0 && (
        <Card className="rounded-none border-border/70 bg-card">
          <CardHeader className="p-4 pb-2 border-b border-border/40">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5 font-mono">
              <Sparkles className="size-3.5" />
              Scientific Observation Metadata
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Object.entries(activeHDU.summary).map(([k, v]) => (
              <div key={k} className="space-y-0.5">
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{k}</span>
                <p className="font-mono text-xs font-semibold text-foreground truncate" title={v}>
                  {v}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Mode Switcher when BINTABLE exists */}
      {activeHDU?.table && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-border/70 bg-card/60 p-2.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 font-mono text-xs flex items-center gap-2 border transition-colors ${
                viewMode === 'table'
                  ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <TableProperties className="size-3.5" />
              <span>Decoded Data Table ({activeHDU.table.total_rows.toLocaleString()} rows)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 font-mono text-xs flex items-center gap-2 border transition-colors ${
                viewMode === 'cards'
                  ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="size-3.5" />
              <span>Header Cards ({activeHDU.cards.length} cards)</span>
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>FITS XTENSION:</span>
            <Badge variant="outline" className="rounded-none font-mono text-[10px] text-primary">
              BINTABLE (Binary Table)
            </Badge>
          </div>
        </div>
      )}

      {/* VIEW MODE 1: Decoded Binary Table & Chart */}
      {activeHDU?.table && viewMode === 'table' && (
        <div className="space-y-6">
          {/* Quick Photometric Light Curve Plot */}
          {chartData.length > 0 && (
            <Card className="rounded-none border-border/70">
              <CardHeader className="p-4 border-b border-border/60 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-primary" />
                    <div>
                      <CardTitle className="text-sm font-semibold">Photometric Light Curve Preview</CardTitle>
                      <CardDescription className="text-xs font-mono">
                        Time (BJD) vs Flux · Downsampled {chartData.length} cadences across {activeHDU.table.total_rows.toLocaleString()} total observations
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] rounded-none">
                    Downsampled Curve
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-6">
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 15 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#888' }}
                        tickFormatter={(v) => typeof v === 'number' ? v.toFixed(1) : String(v)}
                        domain={['auto', 'auto']}
                        name="Time"
                        unit=" d"
                      />
                      <YAxis
                        dataKey="flux"
                        tick={{ fontSize: 10, fill: '#888' }}
                        tickFormatter={(v) => typeof v === 'number' ? v.toLocaleString() : String(v)}
                        domain={['auto', 'auto']}
                        width={65}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#090d16', borderColor: 'rgba(255,255,255,0.15)', borderRadius: 0, fontFamily: 'monospace', fontSize: 11 }}
                        formatter={(val: any) => [typeof val === 'number' ? val.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(val), 'Flux (e-/s)']}
                        labelFormatter={(t: any) => `Time: ${typeof t === 'number' ? t.toFixed(4) : t} BJD`}
                      />
                      <Line
                        type="monotone"
                        dataKey="flux"
                        stroke="#0ea5e9"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Decoded Rows Table */}
          <Card className="rounded-none border-border/70">
            <CardHeader className="p-4 border-b border-border/60 pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold">Decoded Binary Table Data</CardTitle>
                  <CardDescription className="text-xs">
                    Showing first {activeHDU.table.rows.length} cadences of {activeHDU.table.total_rows.toLocaleString()} total rows across {activeHDU.table.columns.length} columns
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 max-w-sm">
                  <Input
                    placeholder="Search row values…"
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[520px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 sticky top-0 z-10 font-mono text-[11px] uppercase">
                      <TableHead className="w-16">#</TableHead>
                      {activeHDU.table.columns.map((col) => (
                        <TableHead key={col.name} className="whitespace-nowrap px-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{col.name}</span>
                            <span className="text-[9px] text-muted-foreground font-normal lowercase">
                              {col.type}{col.unit ? ` · ${col.unit}` : ''}
                            </span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTableRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={activeHDU.table.columns.length + 1} className="h-24 text-center text-xs text-muted-foreground font-mono">
                          No table rows match filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTableRows.map((row, idx) => (
                        <TableRow key={row._row ?? idx} className="hover:bg-muted/20 font-mono text-xs">
                          <TableCell className="text-muted-foreground font-semibold text-[11px]">{row._row ?? idx + 1}</TableCell>
                          {activeHDU.table?.columns.map((col) => {
                            const val = row[col.name];
                            return (
                              <TableCell key={col.name} className="whitespace-nowrap px-3 tabular-nums">
                                {formatTableCell(val, col.type)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* VIEW MODE 2: Standard 80-byte Header Cards Table */}
      {activeHDU && (!activeHDU.table || viewMode === 'cards') && (
        <Card className="rounded-none border-border/70">
          <CardHeader className="p-4 border-b border-border/60 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">FITS Header Cards</CardTitle>
                <CardDescription className="text-xs">
                  {activeHDU.cards.length} standard 80-byte FITS card images in {activeHDU.name}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 max-w-sm">
                <Input
                  placeholder="Filter keyword or comment…"
                  value={fitsFilter}
                  onChange={(e) => setFitsFilter(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[520px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 sticky top-0 z-10">
                    <TableHead className="w-48 font-mono text-[11px] uppercase">Keyword</TableHead>
                    <TableHead className="font-mono text-[11px] uppercase">Value</TableHead>
                    <TableHead className="font-mono text-[11px] uppercase">Comment / Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFitsCards.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-24 text-center text-xs text-muted-foreground">
                        No header cards match filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFitsCards.map((card, idx) => (
                      <TableRow key={`${card.keyword}-${idx}`} className="hover:bg-muted/20 font-mono text-xs">
                        <TableCell className="font-semibold text-primary">{card.keyword}</TableCell>
                        <TableCell className="max-w-md truncate text-foreground" title={card.value}>
                          {card.value || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[11px] truncate max-w-sm" title={card.comment}>
                          {card.comment || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
