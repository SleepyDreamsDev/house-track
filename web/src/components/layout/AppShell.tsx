import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

export const AppShell: React.FC = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Listings', path: '/listings' },
    { label: 'Sweeps', path: '/sweeps' },
    { label: 'Filter', path: '/filter' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="flex h-screen bg-neutral-50">
      <aside className="w-64 border-r border-neutral-200 bg-white p-6 flex flex-col">
        <h1 className="mb-8 text-xl font-bold text-neutral-900">House Track</h1>
        <nav className="space-y-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`block rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.path)
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
