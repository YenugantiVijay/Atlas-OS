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
    <header className="border-b border-slate-200 pb-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-atlas-800">
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
          <h1 className="max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-navy-800">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5 xl:shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
