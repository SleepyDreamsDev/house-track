import React from 'react';
import { A_DISTRICTS, DIST_COLORS } from './types.js';

export const FilterGroupVertical: React.FC<{
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: string[];
}> = ({ label, value, setValue, options }) => (
  <div>
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {label}
    </div>
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            onClick={() => setValue(o)}
            className={`rounded-md px-2 py-1 text-[12px] ring-1 ring-inset ${
              active
                ? 'bg-neutral-900 text-white ring-neutral-900'
                : 'bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50'
            }`}
          >
            {o === 'all' ? 'All' : o}
          </button>
        );
      })}
    </div>
  </div>
);

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

export const Legend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
    {A_DISTRICTS.map((d) => (
      <span key={d} className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ background: DIST_COLORS[d] }} />
        <span className="text-neutral-600">{d}</span>
      </span>
    ))}
  </div>
);
