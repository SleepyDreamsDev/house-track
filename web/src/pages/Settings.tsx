import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { Toggle } from '@/components/ui/Toggle.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';

interface Setting {
  key: string;
  value: unknown;
  default: unknown;
  group?: string;
  kind?: 'number' | 'text' | 'select';
  unit?: string;
  hint?: string;
  options?: string[];
  label?: string;
}
interface Source {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  placeholder?: boolean;
}

export const Settings: React.FC = () => {
  const qc = useQueryClient();
  const { data: settings } = useQuery<Setting[]>({
    queryKey: ['settings'],
    queryFn: () => apiCall('/settings'),
  });
  const { data: sources } = useQuery<Source[]>({
    queryKey: ['sources'],
    queryFn: () => apiCall('/sources'),
  });

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      apiCall(`/settings/${key}`, { method: 'PATCH', body: JSON.stringify({ value }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const toggleSource = useMutation({
    mutationFn: ({ id, enabled }: { id: Source['id']; enabled: boolean }) =>
      apiCall(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });

  const groups = useMemo(() => {
    const m: Record<string, Setting[]> = {};
    for (const s of settings ?? []) (m[s.group ?? 'Other'] ||= []).push(s);
    return m;
  }, [settings]);

  return (
    <div data-screen-label="Settings">
      <PageHeader
        title="Settings"
        subtitle="Runtime overrides applied at the start of each sweep"
      />

      <div className="grid grid-cols-[200px_1fr] gap-8">
        <nav className="sticky top-0 self-start space-y-0.5 text-sm">
          {[...Object.keys(groups), 'Sources'].map((g) => (
            <a
              key={g}
              href={`#${g}`}
              className="block rounded-sm px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100"
            >
              {g}
            </a>
          ))}
        </nav>

        <div className="space-y-6">
          {Object.entries(groups).map(([group, items]) => (
            <Card key={group} id={group}>
              <SectionHeader title={group} />
              <div className="divide-y divide-neutral-100">
                {items.map((s) => (
                  <SettingRow
                    key={s.key}
                    s={s}
                    onSave={(v) => update.mutate({ key: s.key, value: v })}
                  />
                ))}
              </div>
            </Card>
          ))}

          <Card id="Sources">
            <SectionHeader title="Sources" />
            <div className="divide-y divide-neutral-100">
              {(sources ?? []).map((src) => (
                <div key={src.id} className="flex items-center gap-3 py-3">
                  <div
                    className={`h-2 w-2 rounded-full ${src.enabled ? 'bg-success' : 'bg-neutral-200'}`}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{src.name}</span>
                      {src.placeholder && <Badge variant="default">not implemented</Badge>}
                    </div>
                    <div className="font-mono text-xs text-neutral-400 truncate">{src.baseUrl}</div>
                  </div>
                  <Toggle
                    checked={src.enabled}
                    disabled={src.placeholder ?? false}
                    onChange={(v) => toggleSource.mutate({ id: src.id, enabled: v })}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const SettingRow: React.FC<{ s: Setting; onSave: (v: unknown) => void }> = ({ s, onSave }) => {
  const [val, setVal] = useState<unknown>(s.value);
  const changed = JSON.stringify(val) !== JSON.stringify(s.value);
  const isOverride = JSON.stringify(s.value) !== JSON.stringify(s.default);

  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs text-neutral-900">{s.key}</code>
          {isOverride && <Badge variant="default">overridden</Badge>}
        </div>
        {s.label && <div className="mt-0.5 text-sm text-neutral-600">{s.label}</div>}
        {s.hint && <div className="text-xs text-neutral-400 mt-0.5">{s.hint}</div>}
      </div>
      <div className="w-44 shrink-0">
        {s.kind === 'select' ? (
          <select
            value={String(val)}
            onChange={(e) => setVal(e.target.value)}
            className="h-8 w-full rounded-sm bg-white px-2 text-sm border border-neutral-200"
          >
            {s.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : s.kind === 'number' ? (
          <div className="relative">
            <input
              type="number"
              value={Number(val)}
              onChange={(e) => setVal(Number(e.target.value))}
              className="h-8 w-full rounded-sm bg-white pl-2.5 pr-12 text-sm text-right tabular-nums border border-neutral-200"
            />
            {s.unit && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
                {s.unit}
              </span>
            )}
          </div>
        ) : (
          <input
            value={String(val)}
            onChange={(e) => setVal(e.target.value)}
            className="h-8 w-full rounded-sm bg-white px-2.5 font-mono text-xs border border-neutral-200"
          />
        )}
      </div>
      <Button
        size="sm"
        variant={changed ? 'default' : 'ghost'}
        disabled={!changed}
        onClick={() => onSave(val)}
      >
        Save
      </Button>
    </div>
  );
};
