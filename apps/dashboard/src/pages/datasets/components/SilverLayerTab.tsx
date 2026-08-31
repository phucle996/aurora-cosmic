import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StorageListing } from '../types';
import { ObjectBrowserTable } from './ObjectBrowserTable';
import { SchemaCatalogCard } from './SchemaCatalogCard';
import { silverLightCurveSchema, silverTargetPixelSchema } from '../types';

interface SilverLayerTabProps {
  silverData: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onFilterPreset: (prefix: string) => void;
}

export function SilverLayerTab({
  silverData,
  loading,
  page,
  totalPages,
  onPageChange,
  onFilterPreset,
}: SilverLayerTabProps): JSX.Element {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-base font-semibold">
                Tệp tin Chuẩn hóa trong MinIO `silver/`
              </CardTitle>
              <CardDescription>
                Dữ liệu chuỗi thời gian Lightcurve và Target Pixel Files đã được lọc nhiễu và lưu dạng Parquet.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onFilterPreset('silver/tess/lightcurve/')}
              >
                Lightcurves Parquet
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onFilterPreset('silver/tess/tpf/')}
              >
                TPF Parquet
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ObjectBrowserTable
            data={silverData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
          />
        </CardContent>
      </Card>

      <SchemaCatalogCard catalog={silverLightCurveSchema} />
      <SchemaCatalogCard catalog={silverTargetPixelSchema} />
    </div>
  );
}
