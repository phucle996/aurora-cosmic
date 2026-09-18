import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { FactoryRun, FactoryTicket } from '@/types/ticket';

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

// Module-level deduplication and cache for the ticket catalog
let cachedTickets: FactoryTicket[] | null = null;
let ticketsInFlight: Promise<FactoryTicket[]> | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export async function fetchTicketCatalog(force = false): Promise<FactoryTicket[]> {
  if (!force && cachedTickets !== null) {
    return cachedTickets;
  }
  if (!force && ticketsInFlight !== null) {
    return ticketsInFlight;
  }

  ticketsInFlight = (async () => {
    try {
      const response = await apiFetch<{ items: FactoryTicket[] }>('/v1/data-factory/tickets?limit=100');
      const items = response.items ?? [];
      cachedTickets = items;
      if (items.length > 0) {
        const firstTicket = items[0]?.ticket_id;
        const currentActive = getStoredActiveTicket();
        if ((!currentActive || currentActive === 'RUN-20260918-8Q5I') && firstTicket) {
          setStoredActiveTicket(firstTicket);
        }
      }
      notifyListeners();
      return items;
    } catch {
      return cachedTickets ?? [];
    } finally {
      ticketsInFlight = null;
    }
  })();

  return ticketsInFlight;
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
  const [tickets, setTickets] = useState<FactoryTicket[]>(() => cachedTickets ?? []);
  const [recentTickets, setRecentTickets] = useState<string[]>(() => {
    const stored = getStoredRecentTickets();
    if (cachedTickets && cachedTickets.length > 0) {
      const ids = cachedTickets.map((t) => t.ticket_id);
      return Array.from(new Set([...ids, ...stored]));
    }
    return stored;
  });
  const [loading, setLoading] = useState(cachedTickets === null);

  const loadTickets = useCallback(async (): Promise<FactoryTicket[]> => {
    setLoading(true);
    try {
      return await fetchTicketCatalog(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleSync = () => {
      const current = cachedTickets ?? [];
      setTickets(current);
      const ids = current.map((t) => t.ticket_id);
      setRecentTickets(Array.from(new Set([...ids, ...getStoredRecentTickets()])));
      setLoading(false);
    };

    listeners.add(handleSync);

    if (cachedTickets === null) {
      void fetchTicketCatalog().then(handleSync);
    } else {
      handleSync();
    }

    const handleTicketChange = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (custom.detail) {
        setActiveTicketState(custom.detail);
        handleSync();
      }
    };

    window.addEventListener('aurora:ticket-change', handleTicketChange);
    return () => {
      listeners.delete(handleSync);
      window.removeEventListener('aurora:ticket-change', handleTicketChange);
    };
  }, []);

  const setActiveTicket = useCallback((ticket: string) => {
    setStoredActiveTicket(ticket);
    setActiveTicketState(ticket);
    const ids = (cachedTickets ?? []).map((t) => t.ticket_id);
    setRecentTickets(Array.from(new Set([...ids, ...getStoredRecentTickets()])));
  }, []);

  const createNewTicket = useCallback((description = ''): string => {
    const fresh = generateRunnerTicket();
    setStoredActiveTicket(fresh);
    setActiveTicketState(fresh);
    recordRecentTicket(fresh);

    void apiFetch<FactoryTicket>('/v1/data-factory/tickets', {
      method: 'POST',
      body: JSON.stringify({ ticket_id: fresh, description }),
    })
      .then((created) => {
        cachedTickets = [created, ...(cachedTickets ?? []).filter((t) => t.ticket_id !== fresh)];
        notifyListeners();
      })
      .catch(() => {
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
    historicalRuns: [],
    loading,
  };
}
