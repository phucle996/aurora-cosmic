import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Database } from 'lucide-react';

import { Tabs, TabsContent } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/api';

import { BronzeLayerTab } from './components/BronzeLayerTab';
import { GoldLayerTab } from './components/GoldLayerTab';
import { LakehouseTierCards } from './components/LakehouseTierCards';
import { SilverLayerTab } from './components/SilverLayerTab';
import type { StorageListing } from './types';

const PAGE_SIZE = 25;

export default function LakehousePage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'bronze' | 'silver' | 'gold'>('gold');

  // Storage states for Medallion Tiers
  const [bronzeData, setBronzeData] = useState<StorageListing | null>(null);
  const [silverData, setSilverData] = useState<StorageListing | null>(null);
  const [goldData, setGoldData] = useState<StorageListing | null>(null);

  const [currentPrefix, setCurrentPrefix] = useState('gold/');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const inFlightRef = useRef<Set<string>>(new Set());

  const loadTier = useCallback(async (tierPrefix: string, targetPage = 1, search = '') => {
    const query = `/v1/lakehouse/objects?prefix=${encodeURIComponent(tierPrefix)}&page=${targetPage}&limit=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
    if (inFlightRef.current.has(query)) {
      return;
    }
    inFlightRef.current.add(query);

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<StorageListing>(query);
      if (tierPrefix.startsWith('bronze')) setBronzeData(data);
      else if (tierPrefix.startsWith('silver')) setSilverData(data);
      else if (tierPrefix.startsWith('gold')) setGoldData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load storage data');
    } finally {
      inFlightRef.current.delete(query);
      setLoading(false);
    }
  }, []);

  // Only load the initial active tab (gold) on mount; do not eagerly fetch all 3 tiers.
  useEffect(() => {
    void loadTier('gold/', 1, '');
  }, [loadTier]);

  const handleTabChange = (tab: string) => {
    const nextTab = tab as 'bronze' | 'silver' | 'gold';
    setActiveTab(nextTab);
    setPage(1);
    setSearchQuery('');
    const prefix = `${nextTab}/`;
    setCurrentPrefix(prefix);

    // Only load if the tab data has not been fetched yet
    const alreadyLoaded =
      (nextTab === 'bronze' && bronzeData !== null) ||
      (nextTab === 'silver' && silverData !== null) ||
      (nextTab === 'gold' && goldData !== null);

    if (!alreadyLoaded) {
      void loadTier(prefix, 1, '');
    }
  };

  const handleSearchOrFilter = (target: string) => {
    const trimmed = target.trim();
    let nextPrefix = `${activeTab}/`;
    let nextSearch = '';

    if (trimmed.includes('/')) {
      nextPrefix = trimmed;
    } else if (trimmed !== '') {
      nextSearch = trimmed;
    }

    setPage(1);
    setCurrentPrefix(nextPrefix);
    setSearchQuery(nextSearch);
    void loadTier(nextPrefix, 1, nextSearch);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void loadTier(currentPrefix, newPage, searchQuery);
  };

  const activeListing = useMemo(() => {
    if (activeTab === 'bronze') return bronzeData;
    if (activeTab === 'silver') return silverData;
    return goldData;
  }, [activeTab, bronzeData, silverData, goldData]);

  const totalPages = useMemo(() => {
    if (activeListing?.total_pages && activeListing.total_pages > 0) {
      return activeListing.total_pages;
    }
    const total = activeListing?.total;
    if (total === undefined || total <= 0) return 1;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [activeListing]);

  return (
    <div className="space-y-5 pb-6">
      <section className="relative overflow-hidden border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            <Database className="size-4" aria-hidden="true" />
            Lakehouse observatory / object catalog
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">Datasets &amp; Feature Store</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground xl:whitespace-nowrap">
            Inventory Bronze FITS, Silver Parquet, and Gold ML features directly from MinIO object storage.
          </p>
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
