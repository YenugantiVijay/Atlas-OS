import React from 'react';

export interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ collapsed = false, className = '' }) => {
  return (
    <div className={`flex items-center gap-2.5 select-none ${className}`}>
      {/* Original Geometric Glyph */}
      <div className="relative w-8 h-8 rounded-lg bg-surface-card border border-border shadow-sm flex items-center justify-center shrink-0 overflow-hidden group">
        <svg viewBox="0 0 48 48" className="w-5 h-5" fill="none">
          <path
            d="M24 8L38 16V32L24 40L10 32V16L24 8Z"
            stroke="#6D28D9"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M24 8V24L38 32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 24L10 32" stroke="#8B5CF6" strokeWidth="2.5" strokeLinejoin="round" />
          <circle cx="24" cy="24" r="4" fill="#8B5CF6" />
          <circle cx="24" cy="24" r="2" fill="#EDE9FE" />
        </svg>
      </div>

      {!collapsed && (
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-base text-content-primary">
              ATLAS
            </span>
            <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-atlas-100 text-atlas-800 tracking-wider">
              OS
            </span>
          </div>
          <span className="text-[10px] text-content-secondary font-medium tracking-tight -mt-0.5">
            Electrical Distribution
          </span>
        </div>
      )}
    </div>
  );
};
