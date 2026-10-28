import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium tracking-tight rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.99] whitespace-nowrap shrink-0';

    const variants = {
      primary:
        'bg-atlas-600 hover:bg-atlas-700 active:bg-atlas-800 text-white shadow-xs focus:ring-atlas-500 border border-transparent',
      secondary:
        'bg-atlas-100 hover:bg-atlas-200/80 active:bg-atlas-200 text-atlas-900 focus:ring-atlas-400 border border-atlas-200/80 shadow-2xs',
      outline:
        'bg-white hover:bg-slate-50 text-content-primary border border-border hover:border-slate-300 focus:ring-atlas-400 shadow-2xs',
      ghost:
        'bg-transparent hover:bg-slate-100 text-content-secondary hover:text-content-primary focus:ring-atlas-400',
      danger:
        'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-xs focus:ring-rose-500 border border-transparent',
    };

    const sizes = {
      sm: 'h-9 px-3 text-xs gap-1.5',
      md: 'h-10 px-4 text-sm gap-2',
      lg: 'h-11 px-5 text-base gap-2.5',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-current" />}
        {!isLoading && leftIcon}
        <span className="inline-flex items-center gap-1 whitespace-nowrap">{children}</span>
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
