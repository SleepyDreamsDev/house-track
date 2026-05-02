import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { apiCall } from '@/lib/api.js';

interface Setting {
  key: string;
  value: unknown;
  default: unknown;
}

interface Source {
  id: string;
  name: string;
  baseUrl: string;
  adapterKey: string;
  enabled: boolean;
}

export const Settings: React.FC = () => {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<Setting[]>({
    queryKey: ['settings'],
    queryFn: () => apiCall('/settings'),
  });

  const { data: sources } = useQuery<Source[]>({
    queryKey: ['sources'],
    queryFn: () => apiCall('/sources'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      await apiCall(`/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setEditingKey(null);
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Settings</h1>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Crawler Tuning</h2>
        <div className="space-y-4">
          {settings?.map((setting) => (
            <div key={setting.key} className="border-b border-neutral-200 pb-4 last:border-b-0">
              <label className="block text-sm font-medium text-neutral-900 mb-1">
                {setting.key}
              </label>
              <p className="text-xs text-neutral-400 mb-2">
                Default: {JSON.stringify(setting.default)}
              </p>
              {editingKey === setting.key ? (
                <div className="flex gap-2">
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      updateMutation.mutate({
                        key: setting.key,
                        value: isNaN(Number(editValue)) ? editValue : Number(editValue),
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <code className="text-sm text-neutral-600 bg-neutral-100 px-2 py-1 rounded-sm">
                    {JSON.stringify(setting.value)}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingKey(setting.key);
                      setEditValue(JSON.stringify(setting.value));
                    }}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Sources</h2>
        <div className="space-y-4">
          {sources?.map((source) => (
            <div key={source.id} className="border-b border-neutral-200 pb-4 last:border-b-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-neutral-900">{source.name}</h3>
                  <p className="text-xs text-neutral-400 mt-1">{source.baseUrl}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-neutral-600">
                    {source.enabled ? (
                      <span className="text-success">Enabled</span>
                    ) : (
                      <span className="text-neutral-400">Disabled</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Global Filter</h2>
        <p className="text-sm text-neutral-600">Configure search filters for listings</p>
      </Card>
    </div>
  );
};
