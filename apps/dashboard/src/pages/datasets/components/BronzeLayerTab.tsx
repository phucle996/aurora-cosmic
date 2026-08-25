import { useState } from 'react';
import type { JSX } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StorageListing } from '../types';
import { ObjectBrowserTable } from './ObjectBrowserTable';
import { SchemaCatalogCard } from './SchemaCatalogCard';
import {
  bronzeFfiFitsSchema,
  bronzeLightCurveFitsSchema,
  bronzeManifestSchema,
  bronzeTargetPixelFitsSchema,
} from '../types';

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold">
                Tệp FITS Thô trong MinIO `bronze/`
              </CardTitle>
              <CardDescription>
                Kho lưu trữ đối tượng bất biến thô tải trực tiếp từ NASA MAST theo từng Sector.
              </CardDescription>
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                placeholder="Prefix (ví dụ: bronze/tess/)..."
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
            data={bronzeData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </CardContent>
      </Card>

      <SchemaCatalogCard catalog={bronzeManifestSchema} />
      <SchemaCatalogCard catalog={bronzeLightCurveFitsSchema} />
      <SchemaCatalogCard catalog={bronzeTargetPixelFitsSchema} />
      <SchemaCatalogCard catalog={bronzeFfiFitsSchema} />
    </div>
  );
}
