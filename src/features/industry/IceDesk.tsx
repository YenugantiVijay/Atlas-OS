import { useState, type FormEvent } from 'react';
import { toPaise } from '@/lib/money';
import { Button } from '@/components/ui/Button';
import type { IceInput, Snapshot } from './operations';
import { Field, Text, NumberField, inputClass, money, panel, text, number, type Save } from './fields';

const eventLabels = {
  receive: 'Receive stock',
  sale: 'Record sale',
  waste: 'Record waste',
  count: 'Count closing stock',
  close: 'Close stall',
  promise: 'Commit cases',
  dispatch: 'Dispatch cases',
  return: 'Record return or credit',
} satisfies Record<IceInput['kind'], string>;
const submitLabels = {
  receive: 'Save receipt',
  sale: 'Save sale',
  waste: 'Save waste',
  count: 'Save stock count',
  close: 'Save close',
  promise: 'Save commitment',
  dispatch: 'Save dispatch',
  return: 'Save return',
} as const;
const choicesFor = (distribution: boolean): IceInput['kind'][] =>
  distribution
    ? ['receive', 'promise', 'dispatch', 'return']
    : ['sale', 'receive', 'waste', 'count', 'close'];

export function IceDesk({
  snapshot,
  save,
  busy,
  canWrite,
  distribution,
  role,
}: {
  snapshot: Snapshot;
  save: Save;
  busy: boolean;
  canWrite: boolean;
  distribution: boolean;
  role?: string | null;
}) {
  const choices = choicesFor(distribution).filter(
    (kind) =>
      ['owner', 'admin'].includes(role ?? '') ||
      (role === 'inventory' && ['receive', 'waste', 'count'].includes(kind)) ||
      (role === 'sales' && ['sale', 'close', 'promise', 'dispatch'].includes(kind)) ||
      (role === 'accounts' && ['return', 'close'].includes(kind)),
  );
  const [selected, setSelected] = useState<IceInput['kind']>(distribution ? 'receive' : 'sale');
  const [site, setSite] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('piece');
  const kind = choices.includes(selected) ? selected : choices[0];
  const stock = snapshot.stock ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || (kind !== 'close' && !sku.trim()) || !site.trim()) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await save({
        kind,
        site: site.trim(),
        sku: kind === 'close' ? '' : sku.trim(),
        unit: distribution ? 'case' : kind === 'close' ? '' : unit,
        batch: distribution && kind !== 'promise' ? text(fields, 'batch') : '',
        quantity: number(fields, 'quantity'),
        reference: text(fields, 'reference'),
        amount_paise: toPaise(number(fields, 'amount')),
        detail: text(fields, 'detail'),
        method: text(fields, 'method'),
        expiry: text(fields, 'expiry'),
      })
    )
      form.reset();
  }

  return (
    <>
      {canWrite && choices.length > 0 && (
        <section className={panel} aria-labelledby="ice-operation">
          <h2 id="ice-operation" className="text-lg font-bold">
            {distribution ? 'Distribution desk' : 'Stall counter'}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Operations">
            {choices.map((choice) => (
              <Button
                key={choice}
                type="button"
                variant={kind === choice ? 'primary' : 'outline'}
                disabled={busy}
                aria-pressed={kind === choice}
                onClick={() => setSelected(choice)}
              >
                {eventLabels[choice]}
              </Button>
            ))}
          </div>
          {kind === 'sale' && stock.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Tap a product to fill the stall and SKU</p>
              <div className="flex flex-wrap gap-2">
                {stock.slice(0, 24).map((bin) => (
                  <Button
                    key={JSON.stringify(bin)}
                    type="button"
                    variant="outline"
                    disabled={busy}
                    aria-pressed={
                      site.toUpperCase() === bin.site &&
                      sku.toUpperCase() === bin.sku &&
                      unit === bin.unit
                    }
                    onClick={() => {
                      setSite(bin.site);
                      setSku(bin.sku);
                      setUnit(bin.unit);
                    }}
                  >
                    {bin.sku} · {bin.quantity} {bin.unit} · {bin.site}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <form key={kind} onSubmit={submit} className="mt-4">
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={distribution ? 'Freezer or depot' : 'Stall'}>
                <input
                  className={inputClass}
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                  maxLength={60}
                  required
                />
              </Field>
              {kind !== 'close' && (
                <>
                  <Field label="Product SKU or flavor">
                    <input
                      className={inputClass}
                      value={sku}
                      onChange={(event) => setSku(event.target.value)}
                      maxLength={80}
                      required
                    />
                  </Field>
                  {distribution ? (
                    kind !== 'promise' && <Text name="batch" label="Factory batch" maxLength={60} />
                  ) : (
                    <Field label="Stock unit">
                      <select
                        className={inputClass}
                        value={unit}
                        onChange={(event) => setUnit(event.target.value)}
                      >
                        <option value="piece">Packaged piece</option>
                        <option value="scoop">Estimated scoop</option>
                      </select>
                    </Field>
                  )}
                  <NumberField
                    name="quantity"
                    label={kind === 'count' ? 'Counted quantity' : distribution ? 'Cases' : 'Quantity'}
                    min={kind === 'count' ? 0 : 1}
                    max={100000000}
                    step="1"
                  />
                </>
              )}
              {kind === 'receive' && distribution && (
                <Field label="Batch expiry">
                  <input
                    className={inputClass}
                    name="expiry"
                    type="date"
                    min={snapshot.today}
                    required
                  />
                </Field>
              )}
              {distribution && kind === 'receive' && (
                <Text
                  name="reference"
                  label="Factory receipt reference"
                  maxLength={80}
                  required={false}
                />
              )}
              {distribution && kind !== 'receive' && (
                <Text name="reference" label="Customer order reference" maxLength={80} />
              )}
              {kind === 'promise' && <Text name="detail" label="Customer or outlet" />}
              {kind === 'sale' && (
                <>
                  <Field label="Payment method">
                    <select className={inputClass} name="method">
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                    </select>
                  </Field>
                  {unit === 'scoop' && (
                    <Field label="Serve in">
                      <select className={inputClass} name="detail">
                        <option>Cup</option>
                        <option>Cone</option>
                      </select>
                    </Field>
                  )}
                </>
              )}
              {kind === 'waste' && (
                <Field label="Waste reason">
                  <select className={inputClass} name="detail">
                    <option>Melted</option>
                    <option>Damaged</option>
                    <option>Complimentary</option>
                  </select>
                </Field>
              )}
              {kind === 'return' && (
                <Field label="Stock treatment">
                  <select className={inputClass} name="detail">
                    <option>Damaged</option>
                    <option>Restock</option>
                  </select>
                </Field>
              )}
              {['sale', 'return', 'close'].includes(kind) && (
                <NumberField
                  name="amount"
                  label={
                    kind === 'close'
                      ? 'Counted cash takings (₹)'
                      : kind === 'return'
                        ? 'Credit allowance (₹)'
                        : 'Amount collected (₹)'
                  }
                  min={kind === 'sale' ? 0.01 : 0}
                  max={100000000}
                  step="0.01"
                />
              )}
            </fieldset>
            {kind === 'close' && (
              <p className="mt-2 text-sm text-content-secondary">
                Exclude opening float. Closing locks today’s stall entries.
              </p>
            )}
            <Button type="submit" className="mt-4" disabled={busy}>
              {submitLabels[kind]}
            </Button>
          </form>
        </section>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <section className={panel}>
          <h2 className="text-lg font-bold">
            {distribution ? 'Stock by freezer and batch' : 'Stock by stall'}
          </h2>
          <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
            {stock.map((bin) => (
              <li
                key={JSON.stringify(bin)}
                className="flex flex-wrap justify-between gap-2 py-2 text-sm"
              >
                <span className="break-all">
                  {bin.site} · {bin.sku} {bin.batch && '· ' + bin.batch}
                </span>
                <strong>
                  {bin.quantity.toLocaleString('en-IN')} {bin.unit}
                  {bin.expiry && (
                    <span
                      className={bin.expiry < snapshot.today ? 'text-red-700' : 'text-content-secondary'}
                    >
                      {' '}
                      · {bin.expiry < snapshot.today ? 'Expired' : 'Expiry'} {bin.expiry}
                    </span>
                  )}
                </strong>
              </li>
            ))}
          </ul>
          {!stock.length && (
            <p className="text-sm text-content-secondary">Receive stock to populate this list.</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="text-lg font-bold">
            {distribution ? 'Open case commitments' : 'Today’s till by stall'}
          </h2>
          {distribution ? (
            <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
              {snapshot.orders?.map((order) => (
                <li key={order.reference + '/' + order.sku} className="break-words py-2 text-sm">
                  <strong>
                    {order.reference} · {order.sku}
                  </strong>
                  <p>
                    {order.customer} · {order.dispatched} of {order.promised} dispatched ·{' '}
                    {order.promised - order.dispatched} open
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
              {snapshot.tills?.map((till) => (
                <li key={till.site} className="break-words py-2 text-sm">
                  <strong>{till.site}</strong>
                  <p>
                    Expected cash {money(till.cash)} · UPI {money(till.upi)}
                  </p>
                  <p>
                    {till.counted === null
                      ? 'Open'
                      : `Closed · Counted ${money(till.counted)} · Difference ${money(till.counted - till.cash)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!(distribution ? snapshot.orders?.length : snapshot.tills?.length) && (
            <p className="text-sm text-content-secondary">No entries to display.</p>
          )}
        </section>
      </div>
      <section className={panel}>
        <h2 className="text-lg font-bold">Recent activity</h2>
        <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
          {snapshot.events?.map((event) => (
            <li key={event.id} className="break-words py-2 text-sm">
              <strong>{eventLabels[event.kind]}</strong> · {event.day} · {event.site}
              {event.sku && ` · ${event.sku} · ${event.quantity} ${event.unit}`}
              {event.batch && ` · Batch ${event.batch}`}
              {event.reference && ` · ${event.reference}`}
              {event.detail && ` · ${event.detail}`}
              {Boolean(event.amount_paise) && ` · ${money(event.amount_paise ?? 0)}`}
            </li>
          ))}
        </ul>
        {!snapshot.events?.length && (
          <p className="text-sm text-content-secondary">Saved operations will appear here.</p>
        )}
      </section>
    </>
  );
}

