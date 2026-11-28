import { useRef, useState, type FormEvent } from 'react';
import { toPaise } from '@/lib/money';
import { Button } from '@/components/ui/Button';
import type { IceInput, Snapshot } from './operations';
import { Field, Text, NumberField, inputClass, money, panel, text, number, type Save } from './fields';
import { StallCashDesk } from './StallCashDesk';

const eventLabels = {
  receive: 'Receive stock',
  sale: 'Record sale',
  waste: 'Write off stock',
  transfer: 'Transfer stock',
  transfer_in: 'Transfer received',
  transfer_out: 'Transfer sent',
  open: 'Open stall',
  close_day: 'Close stall',
  count: 'Count closing stock',
  close: 'Close stall',
  promise: 'Commit cases',
  dispatch: 'Dispatch cases',
  return: 'Record return or credit',
} satisfies Record<IceInput['kind'] | 'close' | 'transfer_in' | 'transfer_out', string>;
const submitLabels = {
  waste: 'Save write-off',
  transfer: 'Save transfer',
  receive: 'Save receipt',
  sale: 'Save sale',
  count: 'Save stock count',
  promise: 'Save commitment',
  dispatch: 'Save dispatch',
  return: 'Save return',
} as const;
type StockAction = Exclude<IceInput['kind'], 'open' | 'close_day'>;

const choicesFor = (distribution: boolean): StockAction[] =>
  distribution
    ? ['receive', 'promise', 'dispatch', 'return','waste','transfer']
    : ['receive', 'sale', 'count','waste','transfer'];

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
  const managesStalls = ['owner', 'admin'].includes(role ?? '');
  const choices = choicesFor(distribution).filter(
    (kind) =>
      managesStalls ||
      (role === 'inventory' && ['receive', 'count','waste','transfer'].includes(kind)) ||
      (role === 'sales' && ['sale', 'promise', 'dispatch'].includes(kind)) ||
      (role === 'accounts' && kind === 'return'),
  );
  const [selected, setSelected] = useState<StockAction>('receive');
  const [formEpoch,setFormEpoch]=useState(0);
  const countBasis=useRef<{key:string;quantity:number}|null>(null);
  const [countMessage,setCountMessage]=useState('');
  const [site, setSite] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('piece');
  const kind = choices.includes(selected) ? selected : choices[0];
  const stock = snapshot.stock ?? [];
  const countKey=JSON.stringify([site.trim().toUpperCase(),sku.trim().toUpperCase(),unit]);
  const currentQuantity=stock.find(row=>row.site===site.trim().toUpperCase()&&row.sku===sku.trim().toUpperCase()&&row.unit===unit&&row.batch==='')?.quantity??0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || !sku.trim() || !site.trim()) return;
    if(kind==='count'&&countBasis.current?.key!==countKey){setCountMessage('Start a fresh count after choosing the location and product.');return;}
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await save({
        kind,
        site: site.trim(),
        sku: sku.trim(),
        unit: distribution ? 'case' : unit,
        batch: distribution && kind !== 'promise' ? text(fields, 'batch') : '',
        quantity: number(fields, 'quantity'),
        reference: text(fields, 'reference'),
        amount_paise: toPaise(number(fields, 'amount')),
        detail: text(fields, 'detail'),
        method: text(fields, 'method'),
        expiry: text(fields, 'expiry'),
        destination: text(fields,'destination'),
        expected_quantity: kind==='count' ? countBasis.current?.quantity : undefined,
      })
    )
      {form.reset();countBasis.current=null;setCountMessage('');}
  }

  return (
    <>
      {!distribution && (
        <StallCashDesk
          key={snapshot.today}
          tills={snapshot.tills ?? []}
          today={snapshot.today}
          canOpen={canWrite && managesStalls}
          canClose={canWrite && (managesStalls || role === 'sales' || role === 'accounts')}
          busy={busy}
          save={save}
          onSelectStall={setSite}
        />
      )}
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
                onClick={() => {setSelected(choice);countBasis.current=null;setCountMessage('');}}
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
          <form key={kind+':'+formEpoch} onSubmit={submit} className="mt-4">
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={distribution ? 'Freezer or depot' : 'Stall name'}>
                <input
                  className={inputClass}
                  value={site}
                  onChange={(event) => {setSite(event.target.value);countBasis.current=null;}}
                  maxLength={60}
                  required
                />
              </Field>
              <Field label="Product SKU or flavor">
                <input
                  className={inputClass}
                  value={sku}
                  onChange={(event) => {setSku(event.target.value);countBasis.current=null;}}
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
                    onChange={(event) => {setUnit(event.target.value);countBasis.current=null;}}
                  >
                    <option value="piece">Packaged piece</option>
                    <option value="scoop">Estimated scoop</option>
                  </select>
                </Field>
              )}
              <NumberField
                onFocus={()=>{if(kind==='count'&&countBasis.current?.key!==countKey)countBasis.current={key:countKey,quantity:currentQuantity};}}
                name="quantity"
                label={kind === 'count' ? 'Counted quantity' : distribution ? 'Cases' : 'Quantity'}
                min={kind === 'count' ? 0 : 1}
                max={100000000}
                step="1"
              />
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
              {distribution && ['promise','dispatch','return'].includes(kind) && (
                <Text name="reference" label="Customer order reference" maxLength={80} />
              )}
              {kind==='transfer'&&<Text name="destination" label="Destination location" maxLength={60}/>}
              {['waste','transfer','count'].includes(kind)&&<Text name="detail" label="Stock adjustment reason (at least 5 characters)"/>}
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
              {kind === 'return' && (
                <Field label="Stock treatment">
                  <select className={inputClass} name="detail">
                    <option>Damaged</option>
                    <option>Restock</option>
                  </select>
                </Field>
              )}
              {(kind === 'sale' || kind === 'return') && (
                <NumberField
                  name="amount"
                  label={kind === 'return' ? 'Credit allowance (₹)' : 'Amount collected (₹)'}
                  min={kind === 'sale' ? 0.01 : 0}
                  max={100000000}
                  step="0.01"
                />
              )}
            </fieldset>
            {kind==='count'&&<div className="mt-3 text-sm"><p>Counts use the balance captured when you start entering the quantity. If stock changed, refresh and recount.</p><Button type="button" variant="outline" disabled={busy} onClick={()=>{setFormEpoch(v=>v+1);countBasis.current=null;setCountMessage('Enter the new physical count after reviewing refreshed stock.');}}>Start a fresh count</Button>{countMessage&&<p role="status">{countMessage}</p>}</div>}
            <Button type="submit" className="mt-4" disabled={busy}>
              {submitLabels[kind]}
            </Button>
          </form>
        </section>
      )}
      <div className={distribution ? 'grid gap-4 xl:grid-cols-2' : undefined}>
        <section className={panel}>
          <p className="mb-3 text-sm text-content-secondary">Transfers move stock between locations atomically. Write-offs record melted, expired or damaged stock without changing cash or issuing a customer credit.</p>
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
        {distribution && (
          <section className={panel}>
            <h2 className="text-lg font-bold">Open case commitments</h2>
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
            {!snapshot.orders?.length && (
              <p className="text-sm text-content-secondary">No entries to display.</p>
            )}
          </section>
        )}
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
              {(Boolean(event.amount_paise) || ((event.kind === 'open' || event.kind === 'close') && event.amount_paise != null)) && ` · ${money(event.amount_paise ?? 0)}`}
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

