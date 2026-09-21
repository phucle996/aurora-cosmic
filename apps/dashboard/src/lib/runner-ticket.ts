import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { PipelineRun, RunnerTicket } from '@/pages/runner-tickets/types';

export const ACTIVE_TICKET_STORAGE_KEY = 'aurora.data-factory.active-ticket';

export function generateRunnerTicket(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RUN-${dateStr}-${randomHex}`;
}

export function getStoredActiveTicket(): string {
  try {
    const saved = window.localStorage.getItem(ACTIVE_TICKET_STORAGE_KEY);
    return saved && saved.trim() ? saved.trim() : '';
  } catch {
    return '';
  }
}

export function setStoredActiveTicket(ticket: string): void {
  const normalized = ticket.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(ACTIVE_TICKET_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent('aurora:ticket-change', { detail: normalized }));
  } catch {
    // LocalStorage failure
  }
}

// Module-level deduplication and cache for the ticket catalog from ClickHouse API
let cachedTickets: RunnerTicket[] | null = null;
let ticketsInFlight: Promise<RunnerTicket[]> | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export async function fetchTicketCatalog(force = false): Promise<RunnerTicket[]> {
  if (!force && cachedTickets !== null) {
    return cachedTickets;
  }
  if (!force && ticketsInFlight !== null) {
    return ticketsInFlight;
  }

  ticketsInFlight = (async () => {
    try {
      const response = await apiFetch<{ items: RunnerTicket[] }>('/v1/data-factory/tickets?limit=100');
      const items = response.items ?? [];
      cachedTickets = items;
      if (items.length > 0) {
        const currentActive = getStoredActiveTicket();
        const exists = items.some((t) => t.ticket_id === currentActive);
        if (!currentActive || !exists) {
          const firstTicket = items[0]?.ticket_id;
          if (firstTicket) {
            setStoredActiveTicket(firstTicket);
          }
        }
      } else {
        try {
          window.localStorage.removeItem(ACTIVE_TICKET_STORAGE_KEY);
          window.dispatchEvent(new CustomEvent('aurora:ticket-change', { detail: '' }));
        } catch {
          // LocalStorage failure
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
  tickets: RunnerTicket[];
  loadTickets: () => Promise<RunnerTicket[]>;
  recentTickets: string[];
  historicalRuns: PipelineRun[];
  loading: boolean;
} {
  const [activeTicket, setActiveTicketState] = useState<string>(getStoredActiveTicket);
  const [tickets, setTickets] = useState<RunnerTicket[]>(() => cachedTickets ?? []);
  const [loading, setLoading] = useState(cachedTickets === null);

  const loadTickets = useCallback(async (): Promise<RunnerTicket[]> => {
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
      const currentActive = getStoredActiveTicket();
      if (current.length > 0 && (!currentActive || !current.some((t) => t.ticket_id === currentActive))) {
        const fallback = current[0]?.ticket_id;
        if (fallback) {
          setStoredActiveTicket(fallback);
          setActiveTicketState(fallback);
        }
      } else if (currentActive) {
        setActiveTicketState(currentActive);
      }
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
  }, []);

  const createNewTicket = useCallback((description = ''): string => {
    const fresh = generateRunnerTicket();
    setStoredActiveTicket(fresh);
    setActiveTicketState(fresh);

    void apiFetch<RunnerTicket>('/v1/data-factory/tickets', {
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
    recentTickets: tickets.map((t) => t.ticket_id),
    historicalRuns: [],
    loading,
  };
}
