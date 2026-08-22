import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  size?: 'default' | 'sm' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

    const variants = {
      default: 'bg-slate-900 text-white hover:bg-slate-800',
      outline:
        'border border-slate-300 bg-transparent hover:bg-slate-100 text-slate-900',
      secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
      destructive: 'bg-red-600 text-white hover:bg-red-700',
    };

    const sizes = {
      default: 'h-10 py-2 px-4 text-sm',
      sm: 'h-9 px-3 text-xs',
      lg: 'h-12 px-8 text-base',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
