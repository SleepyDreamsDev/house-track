import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'ghost' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    const baseClass =
      'px-4 py-2 rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
    const variants = {
      default: 'bg-black text-white hover:bg-gray-900',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
      ghost: 'hover:bg-gray-100',
      secondary: 'bg-gray-200 text-black hover:bg-gray-300',
    };
    const sizes = {
      sm: 'px-2 py-1 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg',
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
