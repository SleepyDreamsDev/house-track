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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Listings</h1>

      <Card>
        <div className="mb-4 space-y-4">
          <div>
            <label className="block text-sm font-medium">Max Price (EUR)</label>
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
          <p className="text-gray-500">Loading...</p>
        ) : error ? (
          <p className="text-red-600">Error loading listings</p>
        ) : (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Title</TableHeader>
                  <TableHeader>Price</TableHeader>
                  <TableHeader>Area</TableHeader>
                  <TableHeader>Rooms</TableHeader>
                  <TableHeader>District</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.listings.map((listing) => (
                  <TableRow key={listing.id}>
                    <TableCell className="font-medium">{listing.title}</TableCell>
                    <TableCell>{listing.priceEur.toLocaleString()} EUR</TableCell>
                    <TableCell>{listing.areaSqm} m²</TableCell>
                    <TableCell>{listing.rooms ?? '-'}</TableCell>
                    <TableCell>{listing.district}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-4 flex justify-between">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="rounded bg-gray-200 px-4 py-2 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-gray-600">
                Page {page + 1} of {Math.ceil((data?.total || 0) / 20)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!data || page >= Math.ceil(data.total / 20) - 1}
                className="rounded bg-gray-200 px-4 py-2 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
