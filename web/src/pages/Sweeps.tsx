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
    if (confirm('Reset circuit breaker?')) {
      circuitMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sweeps</h1>
        <Button
          variant="destructive"
          onClick={handleResetCircuit}
          disabled={circuitMutation.isPending}
        >
          Reset Circuit Breaker
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <p className="text-gray-500">Loading...</p>
        ) : error ? (
          <p className="text-red-600">Error loading sweeps</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Started</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Duration</TableHeader>
                <TableHeader>Pages</TableHeader>
                <TableHeader>New Listings</TableHeader>
                <TableHeader>Errors</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {sweeps?.map((sweep) => (
                <React.Fragment key={sweep.id}>
                  <TableRow
                    onClick={() => setExpandedId(expandedId === sweep.id ? null : sweep.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>{new Date(sweep.startedAt).toLocaleString()}</TableCell>
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
                    <TableCell>{sweep.durationMs}ms</TableCell>
                    <TableCell>{sweep.pagesFetched}</TableCell>
                    <TableCell>{sweep.newListings}</TableCell>
                    <TableCell>
                      <Badge variant={sweep.errorCount > 0 ? 'error' : 'success'}>
                        {sweep.errorCount}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {expandedId === sweep.id && sweep.errorCount > 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-gray-50 p-4">
                        <details>
                          <summary className="cursor-pointer font-medium">
                            Errors ({sweep.errorCount})
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap text-xs">
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
