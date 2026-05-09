import React from 'react';
import { DIST_COLORS } from './types.js';

export const Scatter: React.FC<{
  data: { id: string; areaSqm: number; priceK: number; district: string }[];
  w?: number;
  h?: number;
}> = ({ data, w = 460, h = 240 }) => {
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xMax = 250;
  const xMin = 50;
  const yMax = 320;
  const yMin = 50;
  const xScale = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * innerW;
  const yScale = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * innerH;
  const medianAt = (a: number) => Math.round(a * 1.3);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      {[100, 150, 200, 250, 300].map((t) => (
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
            €{t}k
          </text>
        </g>
      ))}
      {[75, 125, 175, 225].map((t) => (
        <text key={t} x={xScale(t)} y={h - 8} fontSize="10" fill="#9ca3af" textAnchor="middle">
          {t}m²
        </text>
      ))}
      <path
        d={`M${xScale(50)},${yScale(medianAt(50) * 1.15)} L${xScale(250)},${yScale(medianAt(250) * 1.15)} L${xScale(250)},${yScale(medianAt(250) * 0.85)} L${xScale(50)},${yScale(medianAt(50) * 0.85)} Z`}
        fill="#0f766e"
        fillOpacity="0.07"
      />
      <line
        x1={xScale(50)}
        y1={yScale(medianAt(50))}
        x2={xScale(250)}
        y2={yScale(medianAt(250))}
        stroke="#0f766e"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {data.map((pt) => (
        <circle
          key={pt.id}
          cx={xScale(pt.areaSqm)}
          cy={yScale(pt.priceK)}
          r="4"
          fill={DIST_COLORS[pt.district] ?? '#0f766e'}
          fillOpacity="0.85"
          stroke="#fff"
          strokeWidth="1"
        />
      ))}
      <text x={xScale(60)} y={yScale(medianAt(60)) - 6} fontSize="10" fill="#0f766e">
        market median ±15%
      </text>
    </svg>
  );
};
