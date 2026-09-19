import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Sparkles, Telescope } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StorageFITSPreview } from '../../lakehouse/types';

interface FitsSectionProps {
  fits: StorageFITSPreview;
}

export function FitsSection({ fits }: FitsSectionProps): JSX.Element {
  const [activeHduIndex, setActiveHduIndex] = useState(0);
  const [fitsFilter, setFitsFilter] = useState('');

  const activeHDU = fits.hdus?.[activeHduIndex];

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

      {/* Full-width FITS Header Cards Table */}
      {activeHDU && (
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
