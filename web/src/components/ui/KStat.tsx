import React from 'react';

export const KStat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'accent';
  trend?: React.ReactNode;
}> = ({ label, value, hint, tone = 'default', trend }) => (
  <div className="flex flex-col gap-1">
    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
      {label}
    </div>
    <div
      className={`text-[26px] font-semibold leading-none tabular-nums ${tone === 'accent' ? 'text-accent-dark' : 'text-neutral-900'}`}
    >
      {value}
    </div>
    {hint && <div className="text-xs text-neutral-400">{hint}</div>}
    {trend}
  </div>
);
