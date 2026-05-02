import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`rounded-sm border border-neutral-200 bg-white p-6 shadow-sm ${className || ''}`}
    {...props}
  />
));
Card.displayName = 'Card';
