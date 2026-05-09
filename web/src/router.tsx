import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell.js';
import { Dashboard } from '@/pages/Dashboard.js';
import { Listings } from '@/pages/Listings.js';
import { Sweeps } from '@/pages/Sweeps.js';
import { SweepDetail } from '@/pages/SweepDetail.js';
import { Settings } from '@/pages/Settings.js';
import { Filter } from '@/pages/Filter.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'listings', element: <Listings /> },
      { path: 'sweeps', element: <Sweeps /> },
      { path: 'sweeps/:id', element: <SweepDetail /> },
      { path: 'filter', element: <Filter /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
