import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 space-y-3">
      <div className="flex items-start gap-3 text-rose-900">
        <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Unable to load this view</h2>
          <p className="mt-1 text-sm break-words">{message}</p>
        </div>
      </div>
      <Button variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}
