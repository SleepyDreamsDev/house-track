import React from 'react';
import { DIST_COLORS } from './types.js';

export const MultiLineChart: React.FC<{
  series: Record<string, number[]>;
  months: string[];
  w?: number;
  h?: number;
}> = ({ series, months, w = 640, h = 220 }) => {
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const all = Object.values(series).flat();
  if (all.length === 0 || months.length === 0) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        <text x={w / 2} y={h / 2} fontSize="11" fill="#9ca3af" textAnchor="middle">
          No data
        </text>
      </svg>
    );
  }
  const yMax = Math.ceil(Math.max(...all) / 100) * 100;
  const yMin = Math.floor(Math.min(...all) / 100) * 100;
  const span = Math.max(yMax - yMin, 1);
  const len = months.length;
  const xs = months.map((_, i) => padL + (i / Math.max(len - 1, 1)) * innerW);
  const yScale = (v: number) => padT + (1 - (v - yMin) / span) * innerH;
  const yTicks = [yMin, yMin + span / 4, yMin + span / 2, yMin + (3 * span) / 4, yMax];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            y1={yScale(t)}
            x2={w - padR}
            y2={yScale(t)}
            stroke="#f3f4f6"
            strokeWidth="1"
          />
          <text
            x={padL - 6}
            y={yScale(t) + 3}
            fontSize="10"
            fill="#9ca3af"
            textAnchor="end"
            className="tabular-nums"
          >
            €{Math.round(t)}
          </text>
        </g>
      ))}
      {months.map((m, i) =>
        i % 2 === 0 ? (
          <text key={m} x={xs[i] ?? 0} y={h - 8} fontSize="10" fill="#9ca3af" textAnchor="middle">
            {m}
          </text>
        ) : null,
      )}
      {Object.entries(series).map(([name, vals]) => {
        const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i] ?? 0},${yScale(v)}`).join(' ');
        const lastV = vals[len - 1] ?? 0;
        return (
          <g key={name}>
            <path
              d={d}
              fill="none"
              stroke={DIST_COLORS[name] ?? '#0f766e'}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={xs[len - 1] ?? 0}
              cy={yScale(lastV)}
              r="3"
              fill={DIST_COLORS[name] ?? '#0f766e'}
            />
          </g>
        );
      })}
    </svg>
  );
};
