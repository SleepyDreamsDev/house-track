import React from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell.js';
import { Dashboard } from '@/pages/Dashboard.js';
import { Listings } from '@/pages/Listings.js';
import { Sweeps } from '@/pages/Sweeps.js';
import { Settings } from '@/pages/Settings.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'listings', element: <Listings /> },
      { path: 'sweeps', element: <Sweeps /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
