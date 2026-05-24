import React from 'react';
import { DIST_COLORS } from './types.js';

// Generic browse-filter controls now live in the shared rail
// (components/filters/FilterRail.tsx). What remains here is analytics-specific:
// the segmented sort/period control and the district color legend.

export const Segmented: React.FC<{
  options: string[];
  value: string;
  setValue: (v: string) => void;
}> = ({ options, value, setValue }) => (
  <div className="inline-flex rounded-md bg-neutral-100 p-0.5">
    {options.map((o) => {
      const active = value === o;
      return (
        <button
          key={o}
          onClick={() => setValue(o)}
          className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium ${
            active
              ? 'bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/60'
              : 'text-neutral-500 hover:text-neutral-900'
          }`}
        >
          {o}
        </button>
      );
    })}
  </div>
);

export const Legend: React.FC<{ districts: string[] }> = ({ districts }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
    {districts.map((d) => (
      <span key={d} className="inline-flex items-center gap-1">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: DIST_COLORS[d] ?? '#0f766e' }}
        />
        <span className="text-neutral-600">{d}</span>
      </span>
    ))}
  </div>
);
