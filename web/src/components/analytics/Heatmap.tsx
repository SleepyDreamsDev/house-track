import React from 'react';

export const Heatmap: React.FC<{
  data: Record<string, Record<string, number>>;
  districts: string[];
  roomBuckets: string[];
}> = ({ data, districts, roomBuckets }) => {
  const all = districts
    .flatMap((d) => roomBuckets.map((r) => data[d]?.[r] ?? 0))
    .filter((v) => v > 0);
  const min = all.length > 0 ? Math.min(...all) : 0;
  const max = all.length > 0 ? Math.max(...all) : 1;
  const tone = (v: number) => {
    if (max === min) return 'oklch(0.97 0.04 195)';
    const t = (v - min) / (max - min);
    return `oklch(${(0.97 - t * 0.32).toFixed(3)} ${0.04 + t * 0.1} 195)`;
  };
  return (
    <div className="overflow-hidden rounded-md ring-1 ring-neutral-200">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-neutral-50">
            <th className="px-3 py-2 text-left font-semibold text-neutral-500 text-[10.5px] uppercase tracking-wider">
              District
            </th>
            {roomBuckets.map((r) => (
              <th
                key={r}
                className="px-2 py-2 text-right font-semibold text-neutral-500 text-[10.5px] uppercase tracking-wider"
              >
                {r} rooms
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {districts.map((d) => (
            <tr key={d} className="border-t border-neutral-200">
              <td className="px-3 py-2 font-medium text-neutral-700">{d}</td>
              {roomBuckets.map((r) => {
                const v = data[d]?.[r] ?? 0;
                return (
                  <td
                    key={r}
                    className="px-2 py-2 text-right tabular-nums"
                    style={{ background: v > 0 ? tone(v) : undefined }}
                  >
                    {v > 0 ? `€${v}` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
