import React from 'react';

interface RangeFieldProps {
  min?: string;
  max?: string;
  unit?: string;
  units?: string[];
  onChangeMin: (v: string) => void;
  onChangeMax: (v: string) => void;
  onChangeUnit?: (u: string) => void;
}

export const RangeField: React.FC<RangeFieldProps> = ({
  min,
  max,
  unit,
  units,
  onChangeMin,
  onChangeMax,
  onChangeUnit,
}) => {
  const rangeError =
    min !== undefined && max !== undefined && min !== '' && max !== '' && Number(min) > Number(max);

  const effectiveUnit = unit ?? units?.[0];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          placeholder="min"
          value={min ?? ''}
          onChange={(e) => onChangeMin(e.target.value)}
          className="h-8 w-28 rounded-sm border border-neutral-200 bg-white px-2.5 text-sm text-right tabular-nums"
        />
        <span className="text-neutral-400 text-xs">–</span>
        <input
          type="number"
          placeholder="max"
          value={max ?? ''}
          onChange={(e) => onChangeMax(e.target.value)}
          className="h-8 w-28 rounded-sm border border-neutral-200 bg-white px-2.5 text-sm text-right tabular-nums"
        />
        {units && units.length > 1 ? (
          <select
            aria-label="unit"
            value={effectiveUnit ?? ''}
            onChange={(e) => onChangeUnit?.(e.target.value)}
            className="h-8 rounded-sm border border-neutral-200 bg-white px-1.5 text-xs text-neutral-600"
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        ) : (
          effectiveUnit && <span className="text-xs text-neutral-400">{effectiveUnit}</span>
        )}
      </div>
      {rangeError && <p className="text-[11px] text-red-600">min must be ≤ max</p>}
    </div>
  );
};
