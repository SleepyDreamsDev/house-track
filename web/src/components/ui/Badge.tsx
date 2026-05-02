import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'error' | 'warning';
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-gray-100 text-gray-900',
      success: 'bg-green-100 text-green-900',
      error: 'bg-red-100 text-red-900',
      warning: 'bg-yellow-100 text-yellow-900',
    };

    return (
      <div
        ref={ref}
        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${variants[variant]} ${className || ''}`}
        {...props}
      />
    );
  },
);
Badge.displayName = 'Badge';
