import { useState } from 'react';
import type { JSX } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { StorageListing } from '@/features/datasets/types';
import { ObjectBrowserTable } from './ObjectBrowserTable';
import { SchemaCatalogCard } from './SchemaCatalogCard';
import {
  bronzeLightCurveHduSchema,
  bronzeLightCurvePrimaryHeaderSchema,
  bronzeLightCurveFitsSchema,
  bronzeManifestSchema,
  bronzeTargetPixelCosmicRaySchema,
  bronzeTargetPixelHduSchema,
  bronzeTargetPixelFitsSchema,
} from '@/features/datasets/types';

interface BronzeLayerTabProps {
  bronzeData: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onSearch: (prefix: string) => void;
}

export function BronzeLayerTab({
  bronzeData,
  loading,
  page,
  totalPages,
  onPageChange,
  onSearch,
}: BronzeLayerTabProps): JSX.Element {
  const [searchPrefix, setSearchPrefix] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchPrefix.trim() ? searchPrefix.trim() : 'bronze/');
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Object inspector / bronze prefix</p>
              <CardTitle className="mt-1 text-lg">Raw observation artifacts</CardTitle>
              <CardDescription>FITS bất biến tải trực tiếp từ NASA MAST theo từng TESS sector.</CardDescription>
            </div>
            <form onSubmit={handleSubmit} className="flex min-w-0 gap-2 sm:min-w-[22rem]">
              <Input
                aria-label="Bronze object prefix"
                placeholder="bronze/tess/..."
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
            data={bronzeData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </CardContent>
      </Card>

      <SchemaCatalogCard catalog={bronzeManifestSchema} />
      <SchemaCatalogCard catalog={bronzeLightCurveHduSchema} />
      <SchemaCatalogCard catalog={bronzeLightCurvePrimaryHeaderSchema} />
      <SchemaCatalogCard catalog={bronzeLightCurveFitsSchema} />
      <SchemaCatalogCard catalog={bronzeTargetPixelHduSchema} />
      <SchemaCatalogCard catalog={bronzeTargetPixelFitsSchema} />
      <SchemaCatalogCard catalog={bronzeTargetPixelCosmicRaySchema} />
    </div>
  );
}
