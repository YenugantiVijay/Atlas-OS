import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'indigo' | 'primary' | 'violet' | 'teal' | 'navy' | 'success' | 'warning' | 'danger' | 'info' | 'default';
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  showDot = false,
  className = '',
  ...props
}) => {
  const variants: Record<string, string> = {
    indigo: 'bg-teal-50 text-teal-800 border-teal-200/80',
    primary: 'bg-teal-50 text-teal-800 border-teal-200/80',
    violet: 'bg-teal-50 text-teal-800 border-teal-200/80',
    teal: 'bg-teal-50 text-teal-800 border-teal-200/80',
    navy: 'bg-navy-50 text-navy-800 border-navy-200',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-50 text-amber-900 border-amber-200',
    danger: 'bg-rose-50 text-rose-800 border-rose-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  const dotColors: Record<string, string> = {
    indigo: 'bg-teal-600',
    primary: 'bg-teal-600',
    violet: 'bg-teal-600',
    teal: 'bg-teal-600',
    navy: 'bg-navy-700',
    success: 'bg-emerald-600',
    warning: 'bg-amber-600',
    danger: 'bg-rose-600',
    info: 'bg-blue-600',
    default: 'bg-slate-500',
  };

  const sizes = {
    sm: 'text-xs px-2.5 py-0.5 font-medium gap-1.5',
    md: 'text-xs px-3 py-1 font-semibold gap-1.5',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border ${variants[variant]} ${sizes[size]} tracking-tight transition-colors shrink-0 ${className}`}
      {...props}
    >
      {showDot && (
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors[variant]}`}
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
    </span>
  );
};
