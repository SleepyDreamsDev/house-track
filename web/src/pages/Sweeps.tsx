import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table.js';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { apiCall } from '@/lib/api.js';

interface SweepRun {
  id: string;
  startedAt: string;
  durationMs: number;
  status: 'running' | 'success' | 'failed';
  pagesFetched: number;
  newListings: number;
  errorCount: number;
}

export const Sweeps: React.FC = () => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: sweeps,
    isLoading,
    error,
  } = useQuery<SweepRun[]>({
    queryKey: ['sweeps'],
    queryFn: () => apiCall('/sweeps?limit=20'),
  });

  const circuitMutation = useMutation({
    mutationFn: async () => {
      await apiCall('/circuit', { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['circuit'] });
    },
  });

  const handleResetCircuit = () => {
    if (confirm('Reset circuit breaker? This will clear the sentinel file.')) {
      circuitMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">Sweeps</h1>
        <Button
          variant="destructive"
          onClick={handleResetCircuit}
          disabled={circuitMutation.isPending}
        >
          {circuitMutation.isPending ? 'Resetting...' : 'Reset Circuit Breaker'}
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <p className="text-sm text-neutral-400">Loading...</p>
        ) : error ? (
          <p className="text-sm text-error">Error loading sweeps</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Started</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader className="text-right">Duration</TableHeader>
                <TableHeader className="text-right">Pages</TableHeader>
                <TableHeader className="text-right">New</TableHeader>
                <TableHeader className="text-right">Errors</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {sweeps?.map((sweep) => (
                <React.Fragment key={sweep.id}>
                  <TableRow
                    onClick={() => setExpandedId(expandedId === sweep.id ? null : sweep.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="text-sm text-neutral-900">
                      {new Date(sweep.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          sweep.status === 'success'
                            ? 'success'
                            : sweep.status === 'failed'
                              ? 'error'
                              : 'warning'
                        }
                      >
                        {sweep.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {sweep.durationMs}ms
                    </TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {sweep.pagesFetched}
                    </TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {sweep.newListings}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sweep.errorCount > 0 ? 'error' : 'success'}>
                        {sweep.errorCount}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {expandedId === sweep.id && sweep.errorCount > 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-neutral-50 p-4">
                        <details className="group">
                          <summary className="cursor-pointer font-medium text-sm text-neutral-900 group-open:mb-3">
                            Errors ({sweep.errorCount})
                          </summary>
                          <pre className="whitespace-pre-wrap text-xs bg-white border border-neutral-200 rounded-sm p-3 text-neutral-600 font-mono overflow-auto max-h-48">
                            {JSON.stringify({ errors: [] }, null, 2)}
                          </pre>
                        </details>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
};
