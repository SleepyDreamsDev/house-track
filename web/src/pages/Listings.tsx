import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table.js';
import { Card } from '@/components/ui/Card.js';
import { Input } from '@/components/ui/Input.js';
import { Button } from '@/components/ui/Button.js';
import { apiCall } from '@/lib/api.js';

interface Listing {
  id: string;
  title: string;
  priceEur: number;
  areaSqm: number;
  rooms: number | null;
  district: string;
  firstSeenAt: string;
}

export const Listings: React.FC = () => {
  const [maxPrice, setMaxPrice] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useQuery<{ listings: Listing[]; total: number }>({
    queryKey: ['listings', { maxPrice, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (maxPrice !== undefined) params.append('maxPrice', maxPrice.toString());
      params.append('limit', '20');
      params.append('offset', (page * 20).toString());
      return apiCall(`/listings?${params}`);
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / 20);
  const canGoNext = !data || page < totalPages - 1;
  const canGoPrev = page > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Listings</h1>

      <Card>
        <div className="mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-900 mb-2">
              Max Price (EUR)
            </label>
            <Input
              type="number"
              value={maxPrice ?? ''}
              onChange={(e) => {
                setMaxPrice(e.target.value ? parseInt(e.target.value) : undefined);
                setPage(0);
              }}
              placeholder="Enter max price..."
            />
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-neutral-400">Loading...</p>
        ) : error ? (
          <p className="text-sm text-error">Error loading listings</p>
        ) : (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Title</TableHeader>
                  <TableHeader className="text-right">Price (EUR)</TableHeader>
                  <TableHeader className="text-right">Area (m²)</TableHeader>
                  <TableHeader className="text-right">Rooms</TableHeader>
                  <TableHeader>District</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.listings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell className="font-medium text-neutral-900">{listing.title}</TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {listing.priceEur.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {listing.areaSqm}
                    </TableCell>
                    <TableCell className="text-right font-mono text-neutral-600">
                      {listing.rooms ?? '-'}
                    </TableCell>
                    <TableCell className="text-neutral-600">{listing.district}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-6 flex items-center justify-between">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={!canGoPrev}
              >
                Previous
              </Button>
              <span className="text-sm text-neutral-600">
                Page {page + 1} of {Math.max(1, totalPages)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPage(page + 1)}
                disabled={!canGoNext}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
