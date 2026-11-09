import React from 'react';

export interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
  variant?: 'light' | 'dark';
}

/**
 * Official Atlas OS Brand Logo and Wordmark.
 * Uses the official Atlas OS brand mark (/favicon.svg) and navy/teal identity.
 * Visual focus is placed squarely on the geometric mark and crisp ATLAS OS wordmark.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  collapsed = false,
  className = '',
  variant = 'light',
}) => {
  const isDark = variant === 'dark';

  return (
    <div
      className={`flex items-center select-none ${collapsed ? 'justify-center' : 'gap-3'} ${className}`}
      title="Atlas OS"
    >
      <img
        src="/favicon.svg"
        alt="Atlas OS logo"
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-lg shadow-xs transition-transform duration-150"
        draggable={false}
      />
      {!collapsed && (
        <div className="flex items-center tracking-tight leading-none font-heading">
          <span
            className={`text-xl font-extrabold tracking-tight ${
              isDark ? 'text-white' : 'text-navy-700'
            }`}
          >
            ATLAS
          </span>
          <span className="ml-1 text-xl font-extrabold tracking-tight text-teal-400">
            OS
          </span>
        </div>
      )}
    </div>
  );
};
