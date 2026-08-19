import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Layers, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/api';

import { BronzeLayerTab } from './components/BronzeLayerTab';
import { GoldLayerTab } from './components/GoldLayerTab';
import { LakehouseTierCards } from './components/LakehouseTierCards';
import { SilverLayerTab } from './components/SilverLayerTab';
import type { StorageListing } from './types';

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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Layers className="size-4 text-primary" aria-hidden="true" />
            Medallion Data Lakehouse Architecture
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Datasets & Feature Store
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Quản lý tập trung 3 phân lớp dữ liệu (Bronze Thô · Silver Tiền xử lý · Gold Đặc trưng ML) trên kho lưu trữ MinIO S3.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadTier(currentPrefix, page)}
          disabled={loading}
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Storage
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Lakehouse Overview Summary Cards */}
      <LakehouseTierCards
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab)}
        bronzeData={bronzeData}
        silverData={silverData}
        goldData={goldData}
      />

      {/* Main Tabs Explorer */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="gold" className="gap-2">
            🥇 Gold Features
          </TabsTrigger>
          <TabsTrigger value="silver" className="gap-2">
            🥈 Silver Cleaned
          </TabsTrigger>
          <TabsTrigger value="bronze" className="gap-2">
            🥉 Bronze Raw FITS
          </TabsTrigger>
        </TabsList>

        {/* GOLD LAYER TAB */}
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

        {/* SILVER LAYER TAB */}
        <TabsContent value="silver" className="space-y-6">
          <SilverLayerTab
            silverData={silverData}
            loading={loading}
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            onFilterPreset={handleSearchOrFilter}
          />
        </TabsContent>

        {/* BRONZE LAYER TAB */}
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
