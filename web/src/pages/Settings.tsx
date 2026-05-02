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
      <h1 className="text-3xl font-bold">Settings</h1>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Crawler Tuning</h2>
        <div className="space-y-4">
          {settings?.map((setting) => (
            <div key={setting.key} className="border-b pb-4 last:border-b-0">
              <label className="block text-sm font-medium">{setting.key}</label>
              <p className="text-xs text-gray-500">Default: {JSON.stringify(setting.default)}</p>
              {editingKey === setting.key ? (
                <div className="mt-2 flex gap-2">
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} />
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
                <div className="mt-2 flex items-center justify-between">
                  <span>{JSON.stringify(setting.value)}</span>
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
        <h2 className="mb-4 text-lg font-semibold">Sources</h2>
        <div className="space-y-4">
          {sources?.map((source) => (
            <div key={source.id} className="border-b pb-4 last:border-b-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{source.name}</h3>
                  <p className="text-xs text-gray-500">{source.baseUrl}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{source.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Global Filter</h2>
        <p className="text-sm text-gray-600">Configure search filters for listings</p>
      </Card>
    </div>
  );
};
