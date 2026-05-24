import React from 'react';

interface FilterSectionProps {
  label: string;
  selectedCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const FilterSection: React.FC<FilterSectionProps> = ({
  label,
  selectedCount,
  defaultOpen = false,
  children,
}) => (
  <details className="py-2 group" open={defaultOpen}>
    <summary className="flex cursor-pointer items-center gap-2 text-sm select-none list-none">
      <span className="text-neutral-900 font-medium">{label}</span>
      {selectedCount > 0 && (
        <span className="rounded-sm bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {selectedCount}
        </span>
      )}
    </summary>
    <div className="mt-2 pl-1">{children}</div>
  </details>
);
