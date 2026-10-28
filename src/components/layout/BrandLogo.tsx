import React from 'react';

export interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ collapsed = false, className = '' }) => {
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Original Geometric Glyph */}
      <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-atlas-50 to-atlas-100 border border-atlas-200/80 shadow-xs flex items-center justify-center shrink-0 overflow-hidden">
        <svg viewBox="0 0 48 48" className="w-5 h-5" fill="none">
          <path
            d="M24 8L38 16V32L24 40L10 32V16L24 8Z"
            stroke="#4338CA"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M24 8V24L38 32" stroke="#4F46E5" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 24L10 32" stroke="#4F46E5" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="24" cy="24" r="4.5" fill="#4F46E5" />
          <circle cx="24" cy="24" r="2" fill="#E0E7FF" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="font-extrabold tracking-tight text-lg text-content-primary">
              ATLAS
            </span>
            <span className="text-2xs font-bold uppercase px-1.5 py-0.5 rounded-md bg-atlas-100 text-atlas-800 tracking-wider border border-atlas-200/60">
              OS
            </span>
          </div>
          <span className="text-xs text-content-secondary font-medium tracking-tight mt-1">
            Electrical Distribution
          </span>
        </div>
      )}
    </div>
  );
};
