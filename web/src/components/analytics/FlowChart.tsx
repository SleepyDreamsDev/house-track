import React from 'react';

export const FlowChart: React.FC<{
  inventory12w: number[];
  newPerWeek: number[];
  gonePerWeek: number[];
  w?: number;
  h?: number;
}> = ({ inventory12w, newPerWeek, gonePerWeek, w = 380, h = 180 }) => {
  const padL = 36;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  if (inventory12w.length === 0) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        <text x={w / 2} y={h / 2} fontSize="11" fill="#9ca3af" textAnchor="middle">
          No data
        </text>
      </svg>
    );
  }
  const yMax = Math.max(...inventory12w) + 10;
  const yMin = 0;
  const span = Math.max(yMax - yMin, 1);
  const xs = inventory12w.map((_, i) => padL + (i / Math.max(inventory12w.length - 1, 1)) * innerW);
  const yScale = (v: number) => padT + (1 - (v - yMin) / span) * innerH;
  const barW = innerW / inventory12w.length / 2.4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {[0, 80, 160, 240].map((t) => (
        <g key={t}>
          <line
            x1={padL}
            y1={yScale(t)}
            x2={w - padR}
            y2={yScale(t)}
            stroke="#f3f4f6"
            strokeWidth="1"
          />
          <text x={padL - 6} y={yScale(t) + 3} fontSize="10" fill="#9ca3af" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {inventory12w.map((_, i) => {
        const nv = newPerWeek[i] ?? 0;
        const gv = gonePerWeek[i] ?? 0;
        const x = xs[i] ?? 0;
        return (
          <g key={i}>
            <rect
              x={x - barW - 1}
              y={yScale(nv)}
              width={barW}
              height={yScale(0) - yScale(nv)}
              fill="#0f766e"
              rx="1"
            />
            <rect
              x={x + 1}
              y={yScale(gv)}
              width={barW}
              height={yScale(0) - yScale(gv)}
              fill="#f59e0b"
              rx="1"
            />
          </g>
        );
      })}
      <path
        d={inventory12w.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i] ?? 0},${yScale(v)}`).join(' ')}
        fill="none"
        stroke="#111827"
        strokeWidth="1.6"
      />
      {inventory12w.map((v, i) => (
        <circle key={i} cx={xs[i] ?? 0} cy={yScale(v)} r="2" fill="#111827" />
      ))}
      <g transform={`translate(${padL}, ${h - 6})`}>
        <rect x="0" y="-10" width="8" height="8" fill="#0f766e" />
        <text x="12" y="-3" fontSize="10" fill="#525252">
          new
        </text>
        <rect x="50" y="-10" width="8" height="8" fill="#f59e0b" />
        <text x="62" y="-3" fontSize="10" fill="#525252">
          gone
        </text>
        <line x1="100" y1="-6" x2="115" y2="-6" stroke="#111827" strokeWidth="1.6" />
        <text x="120" y="-3" fontSize="10" fill="#525252">
          active
        </text>
      </g>
    </svg>
  );
};
