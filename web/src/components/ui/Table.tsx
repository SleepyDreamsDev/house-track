import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={`w-full border-collapse text-sm ${className || ''}`} {...props} />
  ),
);
Table.displayName = 'Table';

export interface TableHeadProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const TableHead = React.forwardRef<HTMLTableSectionElement, TableHeadProps>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={`border-b border-neutral-200 bg-neutral-100 ${className || ''}`}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

export interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
);
TableBody.displayName = 'TableBody';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={`border-b border-neutral-200 hover:bg-neutral-50 transition-colors ${className || ''}`}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {}

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={`px-4 py-3 text-sm text-neutral-600 ${className || ''}`} {...props} />
  ),
);
TableCell.displayName = 'TableCell';

export interface TableHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {}

export const TableHeader = React.forwardRef<HTMLTableCellElement, TableHeaderProps>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={`px-4 py-3 text-left text-xs font-semibold text-neutral-900 ${className || ''}`}
      {...props}
    />
  ),
);
TableHeader.displayName = 'TableHeader';
