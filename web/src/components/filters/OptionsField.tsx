import React, { useState } from 'react';
import { Input } from '@/components/ui/Input.js';

const SEARCH_THRESHOLD = 10;

interface Option {
  id: number;
  label: string;
}

interface OptionsFieldProps {
  options: Option[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}

export const OptionsField: React.FC<OptionsFieldProps> = ({ options, selectedIds, onToggle }) => {
  const [search, setSearch] = useState('');
  const showSearch = options.length > SEARCH_THRESHOLD;

  const visible =
    showSearch && search
      ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : options;

  return (
    <div className="space-y-2">
      {showSearch && (
        <Input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((opt) => {
          const active = selectedIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              className={`rounded-sm px-2 py-0.5 text-[11px] border transition-colors ${
                active
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
