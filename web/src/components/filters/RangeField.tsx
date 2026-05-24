import React from 'react';

interface RangeFieldProps {
  min?: string;
  max?: string;
  unit?: string;
  onChangeMin: (v: string) => void;
  onChangeMax: (v: string) => void;
}

export const RangeField: React.FC<RangeFieldProps> = ({
  min,
  max,
  unit,
  onChangeMin,
  onChangeMax,
}) => {
  const rangeError =
    min !== undefined && max !== undefined && min !== '' && max !== '' && Number(min) > Number(max);

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
        {unit && <span className="text-xs text-neutral-400">{unit}</span>}
      </div>
      {rangeError && <p className="text-[11px] text-red-600">min must be ≤ max</p>}
    </div>
  );
};
