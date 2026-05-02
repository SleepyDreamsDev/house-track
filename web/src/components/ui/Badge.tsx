import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'error' | 'warning';
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-neutral-100 text-neutral-900',
      success: 'bg-green-50 text-success font-semibold',
      error: 'bg-red-50 text-error font-semibold',
      warning: 'bg-amber-50 text-warning font-semibold',
    };

    return (
      <div
        ref={ref}
        className={`inline-flex rounded-full px-3 py-0.5 text-xs ${variants[variant]} ${className || ''}`}
        {...props}
      />
    );
  },
);
Badge.displayName = 'Badge';
