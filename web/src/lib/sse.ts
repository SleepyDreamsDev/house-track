import { useEffect, useState } from 'react';

// EventSource hook for live sweep streaming.
// Usage:
//   const events = useSse<SweepEvent>(`/api/sweeps/${id}/stream`, sweep?.status === 'running');

export function useSse<T>(url: string, enabled: boolean): T[] {
  const [events, setEvents] = useState<T[]>([]);

  useEffect(() => {
    if (!enabled) return;
    setEvents([]);
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as T;
        setEvents((prev) => [...prev, ev]);
      } catch {
        // ignore malformed
      }
    };
    es.onerror = () => {
      // Allow EventSource to auto-reconnect; just stop appending bad data.
    };
    return () => es.close();
  }, [url, enabled]);

  return events;
}
