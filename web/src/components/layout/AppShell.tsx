import React, { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'appshell:nav-collapsed';

type IconProps = { className?: string };

const icons: Record<string, React.FC<IconProps>> = {
  '/': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 9.5V21h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  '/listings': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </svg>
  ),
  '/sweeps': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <path d="M12 4a8 8 0 1 0 8 8" strokeLinecap="round" />
      <path d="M12 12 18 6" strokeLinecap="round" />
    </svg>
  ),
  '/filter': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  '/analytics': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <path d="M4 20V4" strokeLinecap="round" />
      <path d="M4 20h16" strokeLinecap="round" />
      <path d="M8 16v-3M12 16V8M16 16v-5" strokeLinecap="round" />
    </svg>
  ),
  '/settings': (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export const AppShell: React.FC = () => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — keep in-memory state only */
      }
      return next;
    });
  };

  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Listings', path: '/listings' },
    { label: 'Sweeps', path: '/sweeps' },
    { label: 'Filter', path: '/filter' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="flex h-screen bg-neutral-50">
      <aside
        className={`relative flex flex-col border-r border-neutral-200 bg-white py-6 transition-[width] duration-200 ${
          collapsed ? 'w-16 px-2' : 'w-64 px-6'
        }`}
      >
        <div
          className={`mb-8 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}
        >
          {!collapsed && <h1 className="text-xl font-bold text-neutral-900">House Track</h1>}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
            >
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = icons[item.path];
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={`flex items-center rounded-sm text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'
                } ${
                  active
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200'
                }`}
              >
                {Icon && <Icon className="h-5 w-5 shrink-0" />}
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
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
