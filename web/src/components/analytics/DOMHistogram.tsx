import React from 'react';

export const DOMHistogram: React.FC<{
  buckets: { label: string; count: number; hot?: boolean; stale?: boolean }[];
}> = ({ buckets }) => {
  if (buckets.length === 0) {
    return <div className="text-[12px] text-neutral-400">No data</div>;
  }
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.label} className="flex items-center gap-3 text-[12px]">
          <span className="w-14 text-neutral-600 tabular-nums">{b.label}</span>
          <div className="flex-1 h-4 rounded bg-neutral-100 overflow-hidden">
            <div
              className={`h-full rounded ${
                b.hot ? 'bg-teal-600' : b.stale ? 'bg-amber-500' : 'bg-neutral-400'
              }`}
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums text-neutral-700">{b.count}</span>
        </div>
      ))}
    </div>
  );
};
