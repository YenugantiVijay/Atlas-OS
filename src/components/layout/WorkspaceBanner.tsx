import type { ReactNode } from 'react';

interface WorkspaceBannerProps {
  name: string;
  title: string;
  description: string;
  status?: string;
  icon: ReactNode;
  actions?: ReactNode;
}

export function WorkspaceBanner({ name, title, description, status, icon, actions }: WorkspaceBannerProps) {
  return (
    <header className="relative isolate overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-[#f6f5ff] to-atlas-100/80 px-5 py-5 shadow-sm sm:px-7 sm:py-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-36 -z-10 h-80 w-80 rounded-full border border-atlas-300/50 ring-[28px] ring-atlas-200/25"
      />
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-2 rounded-lg border border-atlas-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-atlas-800">
              <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span>
              {name}
            </span>
            {status && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />
                {status}
              </span>
            )}
          </div>
          <h1 className="max-w-3xl text-2xl font-extrabold leading-tight tracking-tight text-navy-800 sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700 sm:text-base">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5 xl:shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
