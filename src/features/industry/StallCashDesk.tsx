import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { toPaise } from '@/lib/money';
import { formatChartLabel } from './charts';
import { Field, inputClass, money, panel, text, type Save } from './fields';
import type { Till } from './operations';

type Editor = { site: string } | 'new' | null;

function readCashForm(form: HTMLFormElement, enterOpening: boolean) {
  const fields = new FormData(form);
  const site = text(fields, 'site');
  const detail = enterOpening ? text(fields, 'staff') : '';
  const amount = text(fields, enterOpening ? 'opening' : 'closing');
  if (!site || (enterOpening && !detail) || !amount || !form.checkValidity()) return null;
  return { site, detail, amount_paise: toPaise(Number(amount)) };
}

export function StallCashDesk({
  tills, today, canOpen, canClose, busy, save, onSelectStall,
}: {
  tills: Till[];
  today: string;
  canOpen: boolean;
  canClose: boolean;
  busy: boolean;
  save: Save;
  onSelectStall: (site: string) => void;
}) {
  const [editor, setEditor] = useState<Editor>(canOpen && tills.length === 0 ? 'new' : null);
  const [validFormKey, setValidFormKey] = useState<string | null>(null);
  const till = editor && editor !== 'new' ? tills.find(({ site }) => site === editor.site) : undefined;
  const opening = till?.opening ?? null;
  const closing = till?.counted ?? null;
  const opened = opening !== null;
  const closed = closing !== null;
  const enterOpening = !opened && !closed && canOpen;
  const enterClosing = opened && !closed && canClose;
  const formKey = JSON.stringify([editor, opened, closed]);

  function changeEditor(next: Editor) {
    setValidFormKey(null);
    setEditor(next);
  }

  function select(site: string) {
    changeEditor({ site });
    onSelectStall(site);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!enterOpening && !enterClosing)) return;
    const entry = readCashForm(event.currentTarget, enterOpening);
    if (!entry) return;
    const saved = await save({
      kind: enterOpening ? 'open' : 'close_day',
      ...entry,
      sku: '', unit: '', batch: '', reference: '', quantity: 0, method: '', expiry: '',
    });
    if (!saved) return;
    if (enterOpening) select(entry.site.toUpperCase());
    else changeEditor(null);
  }

  return (
    <section className={panel} aria-labelledby="stall-cash">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="stall-cash" className="text-lg font-bold">Daily stall cash</h2>
          <p className="mt-1 text-sm text-content-secondary">{formatChartLabel(today)}</p>
        </div>
        {canOpen && (
          <Button type="button" variant="outline" disabled={busy || editor === 'new'} onClick={() => changeEditor('new')}>
            Add stall
          </Button>
        )}
      </div>
      {tills.length > 0 && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {tills.map((entry) => (
            <li key={entry.site}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={till?.site === entry.site}
                onClick={() => select(entry.site)}
                className="w-full break-words rounded-lg border border-border p-3 text-left text-sm hover:border-atlas-400 aria-pressed:border-atlas-600 aria-pressed:bg-atlas-50"
              >
                <strong className="block text-content-primary">{entry.site}</strong>
                {entry.staff && <span className="block">{entry.staff}</span>}
                <span className="block text-content-secondary">
                  {entry.counted !== null ? 'Closed' : entry.opening == null ? 'Opening cash pending' : 'Closing cash pending'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!editor && tills.length === 0 && (
        <p className="mt-3 text-sm text-content-secondary">No stall cash recorded today.</p>
      )}
      {editor && editor !== 'new' && !till && (
        <p role="status" className="mt-3 text-sm text-content-secondary">Loading stall details…</p>
      )}
      {editor && (editor === 'new' || till) && (
        <form
          key={formKey}
          aria-label="Stall cash form"
          className="mt-4 rounded-xl border border-border bg-surface-panel p-4"
          onSubmit={submit}
          onChange={(event) => setValidFormKey(readCashForm(event.currentTarget, enterOpening) ? formKey : null)}
        >
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <Field label="Stall maintainer">
              <input className={inputClass} name="staff" maxLength={120} defaultValue={till?.staff ?? ''} readOnly={!enterOpening} required={enterOpening} />
            </Field>
            <Field label="Stall name or location">
              <input className={inputClass} name="site" maxLength={60} defaultValue={till?.site ?? ''} readOnly={Boolean(till)} required />
            </Field>
            <Field label="Opening cash (₹)">
              <input className={inputClass} name="opening" type="number" min={0} max={100000000} step="0.01" defaultValue={opening === null ? undefined : opening / 100} readOnly={!enterOpening} required={enterOpening} />
            </Field>
            <Field label="Closing cash (₹)">
              <input className={inputClass} name="closing" type="number" min={0} max={100000000} step="0.01" defaultValue={closing === null ? undefined : closing / 100} disabled={!enterClosing && !closed} readOnly={closed} required={enterClosing} />
            </Field>
          </fieldset>
          {opening !== null && till && (
            <p className="mt-3 text-sm text-content-secondary">
              Expected cash {money(opening + till.cash)} · UPI {money(till.upi)}
            </p>
          )}
          {closing !== null && till && (
            <p className="mt-1 text-sm text-content-secondary">
              Difference {money(closing - ((opening ?? 0) + till.cash))}
            </p>
          )}
          {enterClosing && <p className="mt-2 text-sm text-content-secondary">Count the cash in the drawer, including opening cash.</p>}
          {enterOpening && <p className="mt-2 text-sm text-content-secondary">Enter the maintainer, stall name, and opening cash. Save the opening to unlock closing cash.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {(enterOpening || enterClosing) && (
              <Button type="submit" disabled={busy || validFormKey !== formKey}>{enterOpening ? 'Save opening cash' : 'Save closing cash'}</Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={() => changeEditor(null)}>Hide form</Button>
          </div>
        </form>
      )}
    </section>
  );
}
