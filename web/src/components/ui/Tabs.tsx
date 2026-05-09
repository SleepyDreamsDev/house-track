import React from 'react';

export interface TabDef {
  id: string;
  label: string;
  count?: number | null;
}

export const Tabs: React.FC<{
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="-mt-2 mb-5 border-b border-neutral-200">
    <div role="tablist" className="flex gap-1">
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`relative px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
              isActive ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {t.count != null && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                    isActive ? 'bg-teal-50 text-teal-700' : 'bg-neutral-100 text-neutral-500'
                  }`}
                >
                  {t.count}
                </span>
              )}
            </span>
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-900" />
            )}
          </button>
        );
      })}
    </div>
  </div>
);

export const TabPanel: React.FC<{
  id: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}> = ({ id, label, active, children }) => {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} aria-label={label}>
      {children}
    </div>
  );
};
