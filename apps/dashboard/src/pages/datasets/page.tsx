import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Database, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/api';

import { BronzeLayerTab } from './components/BronzeLayerTab';
import { GoldLayerTab } from './components/GoldLayerTab';
import { LakehouseTierCards } from './components/LakehouseTierCards';
import { SilverLayerTab } from './components/SilverLayerTab';
import type { StorageListing } from '@/features/datasets/types';

const PAGE_SIZE = 25;

export default function DatasetsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'bronze' | 'silver' | 'gold'>('gold');

  // Storage states for Medallion Tiers
  const [bronzeData, setBronzeData] = useState<StorageListing | null>(null);
  const [silverData, setSilverData] = useState<StorageListing | null>(null);
  const [goldData, setGoldData] = useState<StorageListing | null>(null);

  const [currentPrefix, setCurrentPrefix] = useState('gold/');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTier = useCallback(async (tierPrefix: string, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<StorageListing>(
        `/v1/storage?prefix=${encodeURIComponent(tierPrefix)}&page=${targetPage}&limit=${PAGE_SIZE}`,
      );
      if (tierPrefix.startsWith('bronze')) setBronzeData(data);
      else if (tierPrefix.startsWith('silver')) setSilverData(data);
      else if (tierPrefix.startsWith('gold')) setGoldData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu Storage');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load all 3 tiers concurrently with robust error isolation
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    Promise.allSettled([
      apiFetch<StorageListing>(`/v1/storage?prefix=bronze/&page=1&limit=${PAGE_SIZE}`),
      apiFetch<StorageListing>(`/v1/storage?prefix=silver/&page=1&limit=${PAGE_SIZE}`),
      apiFetch<StorageListing>(`/v1/storage?prefix=gold/&page=1&limit=${PAGE_SIZE}`),
    ]).then(([bronzeRes, silverRes, goldRes]) => {
      if (!mounted) return;
      if (bronzeRes.status === 'fulfilled' && bronzeRes.value) setBronzeData(bronzeRes.value);
      if (silverRes.status === 'fulfilled' && silverRes.value) setSilverData(silverRes.value);
      if (goldRes.status === 'fulfilled' && goldRes.value) setGoldData(goldRes.value);
      const unavailableTiers = [
        bronzeRes.status === 'rejected' ? 'Bronze' : null,
        silverRes.status === 'rejected' ? 'Silver' : null,
        goldRes.status === 'rejected' ? 'Gold' : null,
      ].filter((tier): tier is string => tier !== null);
      if (unavailableTiers.length > 0) {
        setError(`Không thể quan sát inventory: ${unavailableTiers.join(', ')}`);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleTabChange = (tab: string) => {
    const nextTab = tab as 'bronze' | 'silver' | 'gold';
    setActiveTab(nextTab);
    setPage(1);
    const prefix = `${nextTab}/`;
    setCurrentPrefix(prefix);
    void loadTier(prefix, 1);
  };

  const handleSearchOrFilter = (targetPrefix: string) => {
    setPage(1);
    setCurrentPrefix(targetPrefix);
    void loadTier(targetPrefix, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void loadTier(currentPrefix, newPage);
  };

  const activeListing = useMemo(() => {
    if (activeTab === 'bronze') return bronzeData;
    if (activeTab === 'silver') return silverData;
    return goldData;
  }, [activeTab, bronzeData, silverData, goldData]);

  const totalPages = useMemo(() => {
    if (!activeListing || activeListing.total <= 0) return 1;
    return Math.max(1, Math.ceil(activeListing.total / PAGE_SIZE));
  }, [activeListing]);

  return (
    <div className="space-y-5 pb-6">
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              <Database className="size-4" aria-hidden="true" />
              Lakehouse observatory / object catalog
            </div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Datasets &amp; Feature Store</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Kiểm kê Bronze FITS, Silver Parquet và Gold ML features trực tiếp từ MinIO object storage.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadTier(currentPrefix, page)}
            disabled={loading}
            className="w-full shrink-0 rounded-none font-mono text-[10px] uppercase tracking-[0.1em] sm:w-auto"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync active prefix
          </Button>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Storage observation interrupted</p><p className="mt-0.5 text-xs">{error}</p></div>
        </div>
      )}

      <LakehouseTierCards
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab)}
        bronzeData={bronzeData}
        silverData={silverData}
        goldData={goldData}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsContent value="gold" className="space-y-6">
          <GoldLayerTab
            goldData={goldData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            onSearch={handleSearchOrFilter}
          />
        </TabsContent>

        <TabsContent value="silver" className="space-y-6">
          <SilverLayerTab
            silverData={silverData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            currentPrefix={currentPrefix}
            onPageChange={handlePageChange}
            onFilterPreset={handleSearchOrFilter}
          />
        </TabsContent>

        <TabsContent value="bronze" className="space-y-6">
          <BronzeLayerTab
            bronzeData={bronzeData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            onSearch={handleSearchOrFilter}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
