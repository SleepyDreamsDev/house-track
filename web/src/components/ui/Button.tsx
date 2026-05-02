import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const baseClass =
      'font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed';
    const variants = {
      default:
        'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-900 focus:ring-neutral-900',
      destructive: 'bg-error text-white hover:bg-red-700 active:bg-error focus:ring-error',
      ghost: 'text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200',
      secondary:
        'bg-neutral-200 text-neutral-900 hover:bg-neutral-300 active:bg-neutral-200 focus:ring-neutral-400',
    };
    const sizes = {
      sm: 'px-2 py-1 text-xs rounded-sm',
      md: 'px-4 py-2 text-sm rounded-sm',
      lg: 'px-6 py-3 text-base rounded-sm',
    };

    return (
      <button
        ref={ref}
        className={`${baseClass} ${variants[variant]} ${sizes[size]} ${className || ''}`}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
