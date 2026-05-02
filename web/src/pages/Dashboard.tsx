import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { apiCall } from '@/lib/api.js';

interface LatestSweep {
  id: string;
  startedAt: string;
  durationMs: number;
  status: 'running' | 'success' | 'failed';
}

interface CircuitState {
  open: boolean;
  openedAt?: string;
}

export const Dashboard: React.FC = () => {
  const {
    data: latestSweep,
    isLoading: sweepLoading,
    error: sweepError,
  } = useQuery<LatestSweep>({
    queryKey: ['sweeps', 'latest'],
    queryFn: () => apiCall('/sweeps/latest'),
  });

  const {
    data: circuit,
    isLoading: circuitLoading,
    error: circuitError,
  } = useQuery<CircuitState>({
    queryKey: ['circuit'],
    queryFn: () => apiCall('/circuit'),
  });

  const sweepStatus = latestSweep?.status || 'unknown';
  const circuitOpen = circuit?.open || false;

  const circuitColor = circuitOpen ? 'error' : 'success';
  const sweepColor =
    sweepStatus === 'success' ? 'success' : sweepStatus === 'failed' ? 'error' : 'warning';

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Last Sweep</h2>
          {sweepLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : sweepError ? (
            <p className="text-red-600">Error loading sweep</p>
          ) : latestSweep ? (
            <div className="space-y-2">
              <div>
                <span className="text-gray-600">Status:</span>
                <span className="ml-2">
                  <Badge variant={sweepColor}>{sweepStatus}</Badge>
                </span>
              </div>
              <div>
                <span className="text-gray-600">Started:</span>
                <span className="ml-2">{new Date(latestSweep.startedAt).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-600">Duration:</span>
                <span className="ml-2">{latestSweep.durationMs}ms</span>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No sweeps available</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Circuit State</h2>
          {circuitLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : circuitError ? (
            <p className="text-red-600">Error loading circuit state</p>
          ) : (
            <div className="space-y-2">
              <div>
                <span className="text-gray-600">Status:</span>
                <span className="ml-2">
                  <Badge variant={circuitColor}>{circuitOpen ? 'OPEN' : 'CLOSED'}</Badge>
                </span>
              </div>
              {circuitOpen && circuit?.openedAt && (
                <div>
                  <span className="text-gray-600">Opened:</span>
                  <span className="ml-2">{new Date(circuit.openedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Grafana Dashboard</h2>
        <Button
          onClick={() => {
            window.open('http://127.0.0.1:3001/d/house-track/overview?kiosk&theme=dark', '_blank');
          }}
        >
          Open in Grafana
        </Button>
      </Card>
    </div>
  );
};
