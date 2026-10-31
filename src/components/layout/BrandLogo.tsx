import React from 'react';

export interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
  variant?: 'light' | 'dark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  collapsed = false,
  className = '',
  variant = 'light',
}) => {
  const isDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Precision Geometric Hexagonal Core */}
      <div className={`relative w-9 h-9 rounded-xl shadow-xs flex items-center justify-center shrink-0 overflow-hidden transition-all ${
        isDark
          ? 'bg-slate-800/90 border border-slate-700'
          : 'bg-gradient-to-br from-teal-50 to-teal-100/60 border border-teal-200/80'
      }`}>
        <svg viewBox="0 0 48 48" className="w-5 h-5" fill="none">
          <path
            d="M24 8L38 16V32L24 40L10 32V16L24 8Z"
            stroke={isDark ? '#38BDF8' : '#142B4D'}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M24 8V24L38 32" stroke="#0D9488" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 24L10 32" stroke="#0D9488" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="24" cy="24" r="4.5" fill="#0D9488" />
          <circle cx="24" cy="24" r="2" fill="#CCFBF1" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5 leading-none">
            <span className={`font-extrabold tracking-tight text-lg ${
              isDark ? 'text-white' : 'text-navy-700'
            }`}>
              ATLAS
            </span>
            <span className="text-2xs font-bold uppercase px-1.5 py-0.5 rounded-md bg-teal-100 text-teal-800 tracking-wider border border-teal-200">
              OS
            </span>
          </div>
          <span className={`text-xs font-medium tracking-tight mt-1 ${
            isDark ? 'text-slate-400' : 'text-content-secondary'
          }`}>
            Electrical Distribution
          </span>
        </div>
      )}
    </div>
  );
};
