import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { FactoryRun } from './types';

export const ACTIVE_TICKET_STORAGE_KEY = 'aurora.data-factory.active-ticket';
export const RECENT_TICKETS_STORAGE_KEY = 'aurora.data-factory.recent-tickets';

export function generateRunnerTicket(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RUN-${dateStr}-${randomHex}`;
}

export function getStoredActiveTicket(): string {
  try {
    const saved = window.localStorage.getItem(ACTIVE_TICKET_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
    const fresh = generateRunnerTicket();
    window.localStorage.setItem(ACTIVE_TICKET_STORAGE_KEY, fresh);
    recordRecentTicket(fresh);
    return fresh;
  } catch {
    return generateRunnerTicket();
  }
}

export function recordRecentTicket(ticket: string): string[] {
  if (!ticket || !ticket.trim()) return [];
  const normalized = ticket.trim();
  try {
    const recents = getStoredRecentTickets();
    const updated = [normalized, ...recents.filter((t) => t !== normalized)].slice(0, 20);
    window.localStorage.setItem(RECENT_TICKETS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [normalized];
  }
}

export function getStoredRecentTickets(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_TICKETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function setStoredActiveTicket(ticket: string): void {
  const normalized = ticket.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(ACTIVE_TICKET_STORAGE_KEY, normalized);
    recordRecentTicket(normalized);
    window.dispatchEvent(new CustomEvent('aurora:ticket-change', { detail: normalized }));
  } catch {
    // LocalStorage failure
  }
}

export function useRunnerTicket(): {
  activeTicket: string;
  setActiveTicket: (ticket: string) => void;
  createNewTicket: () => string;
  recentTickets: string[];
  historicalRuns: FactoryRun[];
  loading: boolean;
} {
  const [activeTicket, setActiveTicketState] = useState<string>(getStoredActiveTicket);
  const [recentTickets, setRecentTickets] = useState<string[]>(getStoredRecentTickets);
  const [historicalRuns, setHistoricalRuns] = useState<FactoryRun[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistorical = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?limit=50');
      const items = response.items ?? [];
      setHistoricalRuns(items);
      const merged = new Set<string>(getStoredRecentTickets());
      for (const item of items) {
        if (item.run_id) merged.add(item.run_id);
      }
      setRecentTickets([...merged]);
    } catch {
      // Historical API unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistorical();
    const handleTicketChange = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail) {
        setActiveTicketState(custom.detail);
        setRecentTickets(getStoredRecentTickets());
      }
    };
    window.addEventListener('aurora:ticket-change', handleTicketChange);
    return () => window.removeEventListener('aurora:ticket-change', handleTicketChange);
  }, [fetchHistorical]);

  const setActiveTicket = useCallback((ticket: string) => {
    setStoredActiveTicket(ticket);
    setActiveTicketState(ticket);
    setRecentTickets(getStoredRecentTickets());
  }, []);

  const createNewTicket = useCallback(() => {
    const fresh = generateRunnerTicket();
    setStoredActiveTicket(fresh);
    setActiveTicketState(fresh);
    setRecentTickets(getStoredRecentTickets());
    return fresh;
  }, []);

  return {
    activeTicket,
    setActiveTicket,
    createNewTicket,
    recentTickets,
    historicalRuns,
    loading,
  };
}
