import type { JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StorageListing } from '@/features/datasets/types';
import { ObjectBrowserTable } from './ObjectBrowserTable';
import { SchemaCatalogCard } from './SchemaCatalogCard';
import { silverFfiSchema, silverLightCurveSchema, silverTargetPixelSchema } from '@/features/datasets/types';

interface SilverLayerTabProps {
  silverData: StorageListing | null;
  loading: boolean;
  page: number;
  totalPages: number;
  currentPrefix: string;
  onPageChange: (newPage: number) => void;
  onFilterPreset: (prefix: string) => void;
}

export function SilverLayerTab({
  silverData,
  loading,
  page,
  totalPages,
  currentPrefix,
  onPageChange,
  onFilterPreset,
}: SilverLayerTabProps): JSX.Element {
  const lightCurvePrefix = 'silver/tess/lightcurve/';
  const targetPixelPrefix = 'silver/tess/target-pixel/';
  const ffiPrefix = 'silver/tess/ffi/';

  return (
    <div className="space-y-4">
      <Card className="rounded-none border-border/80 shadow-none">
        <CardHeader className="border-b border-border/60 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">Object inspector / silver prefix</p>
              <CardTitle className="mt-1 text-lg">Prepared time-series artifacts</CardTitle>
              <CardDescription>Light Curve, Target Pixel và FFI đã được kiểm tra, chuẩn hoá hoặc tổng hợp thành Parquet.</CardDescription>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex">
              <Button
                size="sm"
                variant={currentPrefix === lightCurvePrefix ? 'default' : 'outline'}
                className="h-9 rounded-none font-mono text-[10px] uppercase"
                onClick={() => onFilterPreset(lightCurvePrefix)}
                aria-pressed={currentPrefix === lightCurvePrefix}
              >
                Light curves
              </Button>
              <Button
                size="sm"
                variant={currentPrefix === targetPixelPrefix ? 'default' : 'outline'}
                className="h-9 rounded-none font-mono text-[10px] uppercase"
                onClick={() => onFilterPreset(targetPixelPrefix)}
                aria-pressed={currentPrefix === targetPixelPrefix}
              >
                Target pixels
              </Button>
              <Button
                size="sm"
                variant={currentPrefix === ffiPrefix ? 'default' : 'outline'}
                className="h-9 rounded-none font-mono text-[10px] uppercase"
                onClick={() => onFilterPreset(ffiPrefix)}
                aria-pressed={currentPrefix === ffiPrefix}
              >
                FFI
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
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
      <SchemaCatalogCard catalog={silverFfiSchema} />
    </div>
  );
}
