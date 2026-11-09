import React from 'react';

export interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
  variant?: 'light' | 'dark';
}

/**
 * One official Atlas OS mark for the marketing website, application and favicon.
 * /favicon.svg is kept byte-identical to atlas-os-website/public/favicon.svg.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  collapsed = false,
  className = '',
  variant = 'light',
}) => {
  const isDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      <img
        src="/favicon.svg"
        alt="Atlas OS logo"
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-lg"
        draggable={false}
      />
      {!collapsed && (
        <div className="flex flex-col text-left">
          <div className="flex items-baseline gap-1 leading-none">
            <span className={`text-lg font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-navy-700'}`}>
              ATLAS
            </span>
            <span className="text-lg font-extrabold tracking-tight text-teal-500">OS</span>
          </div>
          <span className={`mt-1 text-xs font-medium tracking-tight ${isDark ? 'text-slate-300' : 'text-content-secondary'}`}>
            Electrical Distribution
          </span>
        </div>
      )}
    </div>
  );
};
