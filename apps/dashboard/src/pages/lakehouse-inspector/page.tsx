import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { apiFetch } from '@/lib/api';
import type { StoragePreviewResponse } from '../lakehouse/types';

import { BinarySection } from './sections/BinarySection';
import { EmptyInspector } from './sections/EmptyInspector';
import { FitsSection } from './sections/FitsSection';
import { InspectorHeader } from './sections/InspectorHeader';
import { JsonSection } from './sections/JsonSection';
import { ParquetSection } from './sections/ParquetSection';
import { TextSection } from './sections/TextSection';

const PAGE_SIZE = 25;

export default function LakehouseInspectorPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const objectKey = searchParams.get('key') || '';

  const [data, setData] = useState<StoragePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const fetchPreview = useCallback(
    async (key: string, targetOffset = 0, currentSearch = '') => {
      if (!key.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          key: key.trim(),
          offset: String(targetOffset),
          limit: String(PAGE_SIZE),
        });
        if (currentSearch.trim()) {
          params.set('search', currentSearch.trim());
        }
        const resp = await apiFetch<StoragePreviewResponse>(`/v1/lakehouse/preview?${params.toString()}`);
        setData(resp);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to inspect lakehouse object');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!objectKey) {
      setData(null);
      setError(null);
      return;
    }
    setPage(0);
    setSearch('');
    void fetchPreview(objectKey, 0, '');
  }, [objectKey, fetchPreview]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!objectKey) return;
    setPage(0);
    void fetchPreview(objectKey, 0, search);
  };

  const handlePageChange = (newPage: number) => {
    if (!objectKey) return;
    setPage(newPage);
    void fetchPreview(objectKey, newPage * PAGE_SIZE, search);
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header Banner & Breadcrumb */}
      <InspectorHeader
        objectKey={objectKey}
        data={data}
        loading={loading}
        onRefresh={() => void fetchPreview(objectKey, page * PAGE_SIZE, search)}
      />

      {/* Direct Key Lookup Form if no key provided */}
      {!objectKey && <EmptyInspector onInspect={(key) => setSearchParams({ key })} />}

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-none border border-destructive/40 bg-destructive/10 text-destructive text-sm flex items-start gap-3">
          <AlertCircle className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to inspect lakehouse object</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3 border border-border/60 bg-card">
          <LoaderCircle className="size-8 animate-spin text-primary" />
          <p className="text-sm font-medium font-mono">Reading and decoding artifact from MinIO object storage…</p>
        </div>
      )}

      {/* Main Content Area */}
      {data && (
        <div className="space-y-6">
          {data.error && (
            <div className="p-3 rounded-none border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
              {data.error}
            </div>
          )}

          {/* 1. Parquet Section */}
          {data.format === 'parquet' && data.parquet && (
            <ParquetSection
              parquet={data.parquet}
              sizeBytes={data.size_bytes}
              page={page}
              pageSize={PAGE_SIZE}
              search={search}
              loading={loading}
              onSearchChange={setSearch}
              onSearchSubmit={handleSearchSubmit}
              onPageChange={handlePageChange}
            />
          )}

          {/* 2. FITS Section */}
          {data.format === 'fits' && data.fits && <FitsSection fits={data.fits} />}

          {/* 3. JSON Section */}
          {data.format === 'json' && <JsonSection content={data.json_content} />}

          {/* 4. Text Section */}
          {data.format === 'text' && <TextSection textContent={data.text_content} />}

          {/* 5. Binary Section */}
          {data.format === 'binary' && (
            <BinarySection sizeBytes={data.size_bytes} contentSha256={data.content_sha256} />
          )}
        </div>
      )}
    </div>
  );
}
