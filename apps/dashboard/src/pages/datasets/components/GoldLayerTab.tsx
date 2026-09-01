import { useState } from 'react';
import type { JSX } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { goldCandidateSchema, type StorageListing } from '@/features/datasets/types';
import { ObjectBrowserTable } from './ObjectBrowserTable';
import { SchemaCatalogCard } from './SchemaCatalogCard';

interface GoldLayerTabProps {
  goldData: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onSearch: (prefix: string) => void;
}

export function GoldLayerTab({
  goldData,
  loading,
  page,
  totalPages,
  onPageChange,
  onSearch,
}: GoldLayerTabProps): JSX.Element {
  const [searchPrefix, setSearchPrefix] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchPrefix.trim() ? searchPrefix.trim() : 'gold/');
  };

  const goldDetailLink = (key: string): string | undefined => {
    const manifest = /^gold\/snapshots\/(gold-v1-[^/]+)\/manifest\.json$/.exec(key);
    if (manifest) return `/gold/snapshots/${encodeURIComponent(manifest[1])}`;

    const artifact = /^gold\/snapshots\/(gold-v1-[^/]+)\/data\/(candidate)\/sector=(\d+)\/[^/]+\.parquet$/.exec(key);
    if (!artifact) return undefined;
    const dataset = artifact[2];
    return `/gold/snapshots/${encodeURIComponent(artifact[1])}/files/${encodeURIComponent(dataset)}/${artifact[3]}`;
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Object inspector / gold prefix</p>
              <CardTitle className="mt-1 text-lg">Gold artifacts</CardTitle>
              <CardDescription>Snapshot manifests, Parquet partitions và current pointers.</CardDescription>
            </div>
            <form onSubmit={handleSubmit} className="flex min-w-0 gap-2 sm:min-w-[22rem]">
              <Input
                aria-label="Gold object prefix"
                placeholder="gold/snapshots/..."
                className="h-9 min-w-0 flex-1 rounded-none font-mono text-xs"
                value={searchPrefix}
                onChange={(e) => setSearchPrefix(e.target.value)}
              />
              <Button type="submit" size="sm" variant="secondary" className="h-9 shrink-0 rounded-none px-3">
                <Search className="size-3.5" />
                <span className="sr-only">Query prefix</span>
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ObjectBrowserTable
            data={goldData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            linkForObject={goldDetailLink}
          />
        </CardContent>
      </Card>

      <SchemaCatalogCard catalog={goldCandidateSchema} />
    </div>
  );
}
