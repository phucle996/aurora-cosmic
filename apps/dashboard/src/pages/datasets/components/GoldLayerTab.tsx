import { useState } from 'react';
import type { JSX } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StorageListing } from '../types';
import { GoldFeatureCatalogCard } from './GoldFeatureCatalogCard';
import { ObjectBrowserTable } from './ObjectBrowserTable';

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
    <div className="space-y-6">
      {/* Active Champion Snapshot Banner & Feature Dictionary */}
      <GoldFeatureCatalogCard />

      {/* Gold Storage Objects Browser */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold">
                Tệp tin trong MinIO `gold/`
              </CardTitle>
              <CardDescription>
                Duyệt các snapshot manifest, parquet partitions và con trỏ hiện tại.
              </CardDescription>
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                placeholder="Prefix (ví dụ: gold/snapshots/)..."
                className="h-8 text-xs w-48 sm:w-64"
                value={searchPrefix}
                onChange={(e) => setSearchPrefix(e.target.value)}
              />
              <Button type="submit" size="sm" variant="secondary" className="h-8">
                <Search className="size-3.5" />
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
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
    </div>
  );
}
