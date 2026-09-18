import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { FactoryRun, FactoryTicket } from './types';

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
    return 'RUN-20260918-8Q5I';
  } catch {
    return 'RUN-20260918-8Q5I';
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
  createNewTicket: (description?: string) => string;
  tickets: FactoryTicket[];
  loadTickets: () => Promise<FactoryTicket[]>;
  recentTickets: string[];
  historicalRuns: FactoryRun[];
  loading: boolean;
} {
  const [activeTicket, setActiveTicketState] = useState<string>(getStoredActiveTicket);
  const [tickets, setTickets] = useState<FactoryTicket[]>([]);
  const [recentTickets, setRecentTickets] = useState<string[]>(getStoredRecentTickets);
  const [historicalRuns, setHistoricalRuns] = useState<FactoryRun[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTickets = useCallback(async (): Promise<FactoryTicket[]> => {
    try {
      const response = await apiFetch<{ items: FactoryTicket[] }>('/v1/data-factory/tickets?limit=100');
      const items = response.items ?? [];
      setTickets(items);
      if (items.length > 0) {
        const ticketIDs = items.map((t) => t.ticket_id);
        setRecentTickets(ticketIDs);
      }
      return items;
    } catch {
      return [];
    }
  }, []);

  const fetchHistorical = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, ticketsRes] = await Promise.allSettled([
        apiFetch<{ items: FactoryRun[] }>('/v1/data-factory/runs?limit=50'),
        loadTickets(),
      ]);
      if (runsRes.status === 'fulfilled') {
        setHistoricalRuns(runsRes.value.items ?? []);
      }
      if (ticketsRes.status === 'fulfilled' && ticketsRes.value.length > 0) {
        // If current active ticket is default and we have real tickets in ClickHouse
        const firstTicket = ticketsRes.value[0]?.ticket_id;
        const currentActive = getStoredActiveTicket();
        if ((!currentActive || currentActive === 'RUN-20260918-8Q5I') && firstTicket) {
          setStoredActiveTicket(firstTicket);
          setActiveTicketState(firstTicket);
        }
      }
    } catch {
      // Historical API unavailable
    } finally {
      setLoading(false);
    }
  }, [loadTickets]);

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

  const createNewTicket = useCallback((description = ''): string => {
    const fresh = generateRunnerTicket();
    setStoredActiveTicket(fresh);
    setActiveTicketState(fresh);
    setRecentTickets(recordRecentTicket(fresh));

    // Persist immediately to ClickHouse database
    void apiFetch<FactoryTicket>('/v1/data-factory/tickets', {
      method: 'POST',
      body: JSON.stringify({ ticket_id: fresh, description }),
    }).then((created) => {
      setTickets((prev) => [created, ...prev.filter((t) => t.ticket_id !== fresh)]);
    }).catch(() => {
      // Fallback retained in local state
    });

    return fresh;
  }, []);

  return {
    activeTicket,
    setActiveTicket,
    createNewTicket,
    tickets,
    loadTickets,
    recentTickets,
    historicalRuns,
    loading,
  };
}
