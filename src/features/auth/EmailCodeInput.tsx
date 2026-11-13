import { useId } from 'react';

export function EmailCodeInput({ value, onChange, disabled }: {
  value: string; onChange: (code: string) => void; disabled: boolean;
}) {
  const id = useId();
  const update = (text: string) => onChange(text.replace(/[^0-9]/g, '').slice(0, 6));
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-content-primary">6-digit code</label>
      <div className="relative rounded-lg focus-within:ring-2 focus-within:ring-teal-600 focus-within:ring-offset-2">
        <div className="grid grid-cols-6 gap-1.5 sm:gap-2" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={`flex h-12 items-center justify-center rounded-lg border font-mono text-xl font-semibold ${
              index === value.length ? 'border-teal-500 bg-teal-50' : 'border-border bg-surface-card'
            }`}>{value[index] || '·'}</span>
          ))}
        </div>
        <input id={id} value={value} inputMode="numeric" autoComplete="one-time-code" autoFocus
          disabled={disabled} pattern="[0-9]{6}" required aria-describedby={id + '-help'}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
          onChange={(event) => update(event.target.value)} onPaste={(event) => {
            event.preventDefault();
            update(event.clipboardData.getData('text'));
          }} />
      </div>
      <p id={id + '-help'} className="text-xs text-content-secondary">You can paste the whole code.</p>
    </div>
  );
}
