import React from 'react';

export const PageHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="mb-6 flex items-start justify-between gap-4">
    <div>
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-neutral-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const SectionHeader: React.FC<{
  title: React.ReactNode;
  hint?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, hint, right }) => (
  <div className="mb-3 flex items-end justify-between gap-3">
    <div className="flex items-baseline gap-2">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      {hint && <span className="text-xs text-neutral-400">{hint}</span>}
    </div>
    {right}
  </div>
);
