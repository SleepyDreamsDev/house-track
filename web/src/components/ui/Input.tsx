import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-sm border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent focus:border-accent disabled:bg-neutral-50 disabled:text-neutral-400 disabled:cursor-not-allowed ${className || ''}`}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
