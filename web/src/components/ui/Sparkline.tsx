import React from 'react';

export const Sparkline: React.FC<{
  data: number[];
  w?: number;
  h?: number;
  className?: string;
}> = ({ data, w = 120, h = 32, className }) => {
  if (!data?.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(max - min, 1);
  const step = w / Math.max(data.length - 1, 1);
  const pts = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  const last = data.length - 1;
  const lx = (last * step).toFixed(1);
  const ly = (h - ((data[last]! - min) / span) * (h - 4) - 2).toFixed(1);
  return (
    <svg width={w} height={h} className={`overflow-visible text-accent ${className ?? ''}`}>
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r="2.5" fill="currentColor" />
    </svg>
  );
};
