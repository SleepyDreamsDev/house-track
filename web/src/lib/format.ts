// Tiny formatting helpers shared across pages.

export const fmt = {
  eur: (n: number) => '€' + Math.round(n).toLocaleString('en-US'),
  num: (n: number) => n.toLocaleString('en-US'),
  ms: (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  },
  rel: (iso: string | Date) => {
    const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
    const diffMin = Math.round((Date.now() - t) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const h = Math.round(diffMin / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  },
  date: (iso: string | Date) => {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  },
  bytes: (n: number) =>
    n > 1_000_000 ? `${(n / 1_048_576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`,
};
