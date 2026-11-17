import { useState, type FormEvent } from 'react';
import { toPaise } from '@/lib/money';
import { Button } from '@/components/ui/Button';
import { quoteTotal, type QuoteLine, type Snapshot } from './operations';
import { Field, Text, NumberField, inputClass, money, panel, text, number, type Save } from './fields';

const quoteDraft = () => ({ label: '', unit: 'piece' as QuoteLine['unit'], quantity: '1', rate: '' });

export function Studio({
  snapshot,
  save,
  busy,
  canWrite,
  role,
}: {
  snapshot: Snapshot;
  save: Save;
  busy: boolean;
  canWrite: boolean;
  role?: string | null;
}) {
  const [lines, setLines] = useState([quoteDraft()]);
  const [dueOnly, setDueOnly] = useState(false);
  const [selected, setSelected] = useState('');
  const [selectedAction, setSelectedAction] = useState<'proof' | 'advance'>('proof');
  const manage = canWrite && ['owner', 'admin', 'sales'].includes(role ?? '');
  const collect = manage || (canWrite && role === 'accounts');
  const jobs = snapshot.jobs ?? [];
  const job = jobs.find((row) => row.id === selected);
  const parsedLines: QuoteLine[] = lines.map((line) => ({
    label: line.label.trim(),
    unit: line.unit,
    quantity: Number(line.quantity),
    rate_paise: toPaise(Number(line.rate)),
  }));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await save({
        kind: 'create',
        customer: text(fields, 'customer'),
        title: text(fields, 'title'),
        due_on: text(fields, 'due'),
        fulfillment: text(fields, 'fulfillment'),
        lines: parsedLines,
      })
    ) {
      form.reset();
      setLines([quoteDraft()]);
    }
  }

  function changeLine(index: number, patch: Partial<ReturnType<typeof quoteDraft>>) {
    setLines((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  return (
    <>
      {manage && (
        <form onSubmit={create} className={panel} id="new-print-job">
          <h2 className="text-lg font-bold">New print job</h2>
          <fieldset disabled={busy} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Text name="title" label="Job name" />
              <Text name="customer" label="Customer" />
              <Field label="Due date">
                <input
                  className={inputClass}
                  type="date"
                  name="due"
                  defaultValue={snapshot.today}
                  required
                />
              </Field>
              <Field label="Fulfillment">
                <select className={inputClass} name="fulfillment">
                  <option value="pickup">Pickup</option>
                  <option value="delivery">Delivery</option>
                </select>
              </Field>
            </div>
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
              >
                <Field label={'Quote item ' + (index + 1)}>
                  <input
                    className={inputClass}
                    required
                    maxLength={120}
                    value={line.label}
                    onChange={(ev) => changeLine(index, { label: ev.target.value })}
                  />
                </Field>
                <Field label="Unit">
                  <select
                    className={inputClass}
                    aria-label="Unit"
                    value={line.unit}
                    onChange={(ev) => changeLine(index, { unit: ev.target.value as QuoteLine['unit'] })}
                  >
                    <option>piece</option>
                    <option>sq ft</option>
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    className={inputClass}
                    type="number"
                    min={line.unit === 'piece' ? 1 : 0.01}
                    max={1000000}
                    step={line.unit === 'piece' ? 1 : 0.01}
                    required
                    value={line.quantity}
                    onChange={(ev) => changeLine(index, { quantity: ev.target.value })}
                  />
                </Field>
                <Field label="Rate (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    min={0.01}
                    max={1000000}
                    step="0.01"
                    required
                    value={line.rate}
                    onChange={(ev) => changeLine(index, { rate: ev.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  disabled={lines.length === 1}
                  className="self-end"
                  onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}
                  aria-label={'Remove quote item ' + (index + 1)}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={lines.length >= 20}
                onClick={() => setLines((rows) => [...rows, quoteDraft()])}
              >
                Add quote item
              </Button>
              <strong className="text-sm">Quote total {money(quoteTotal(parsedLines))}</strong>
              <Button type="submit">Save print job</Button>
            </div>
          </fieldset>
        </form>
      )}
      <section className={panel} aria-labelledby="print-board">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="print-board" className="text-lg font-bold">
            Print job board
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dueOnly}
              onChange={(event) => setDueOnly(event.target.checked)}
            />{' '}
            Due today or overdue
          </label>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {jobs
            .filter((row) => !dueOnly || (row.stage !== 'delivered' && row.due_on <= snapshot.today))
            .map((row) => (
              <article key={row.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-bold">{row.title}</h3>
                  <span className="rounded-full bg-atlas-50 px-3 py-1 text-xs font-bold capitalize text-atlas-800">
                    {row.stage}
                  </span>
                </div>
                <p className="my-2 break-words text-sm text-content-secondary">
                  {row.customer} · Due {row.due_on} · {row.fulfillment}
                </p>
                <p className="text-sm">
                  Quote {money(row.quoted_paise)} · Received {money(row.paid_paise)} · Balance{' '}
                  {money(row.quoted_paise - row.paid_paise)}
                </p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-semibold">
                    Quote lines and artwork history
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {row.lines.map((line, index) => (
                      <li key={index}>
                        {line.label} · {line.quantity} {line.unit} × {money(line.rate_paise)}
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-2 space-y-1">
                    {row.proof_history.map((proof, index) => (
                      <li key={index} className="break-all">
                        Version {index + 1} · {proof}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {manage && ['design', 'proof'].includes(row.stage) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setSelected(row.id);
                        setSelectedAction('proof');
                      }}
                    >
                      Record artwork version
                    </Button>
                  )}
                  {manage && !['design', 'delivered'].includes(row.stage) && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void save({ kind: 'progress', job_id: row.id, expected_stage: row.stage })
                      }
                    >
                      {
                        {
                          proof: 'Approve proof',
                          approved: 'Start printing',
                          printing: 'Mark ready',
                          ready: 'Mark delivered',
                        }[row.stage as 'proof' | 'approved' | 'printing' | 'ready']
                      }
                    </Button>
                  )}
                  {collect && row.paid_paise < row.quoted_paise && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setSelected(row.id);
                        setSelectedAction('advance');
                      }}
                    >
                      Record payment
                    </Button>
                  )}
                </div>
              </article>
            ))}
        </div>
        {jobs.length === 0 && (
          <p className="mt-2 text-sm text-content-secondary">Saved jobs will appear here.</p>
        )}
        {job && (
          <form
            key={job.id + selectedAction}
            className="mt-4 grid max-w-xl gap-3 rounded-xl border border-atlas-200 bg-atlas-50 p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              if (
                await save(
                  selectedAction === 'proof'
                    ? { kind: 'proof', job_id: job.id, detail: text(fields, 'proof') }
                    : {
                        kind: 'advance',
                        job_id: job.id,
                        amount_paise: toPaise(number(fields, 'amount')),
                      },
                )
              )
                setSelected('');
            }}
          >
            <h3 className="font-semibold">{job.title}</h3>
            {selectedAction === 'proof' ? (
              <Text name="proof" label="Artwork file name or reference" />
            ) : (
              <NumberField
                name="amount"
                label="Amount received (₹)"
                min={0.01}
                max={(job.quoted_paise - job.paid_paise) / 100}
                step="0.01"
              />
            )}
            <div className="flex gap-3">
              <Button type="submit" disabled={busy}>
                Save {selectedAction === 'proof' ? 'artwork version' : 'payment'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setSelected('')}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}

