import type { SpecialtyToolId } from '@/lib/industry-tools';
import { getSupabaseClient } from '@/lib/supabase';

export const stages = ['design', 'proof', 'approved', 'printing', 'ready', 'delivered'] as const;
export type Stage = (typeof stages)[number];
export type QuoteLine = { label: string; unit: 'piece' | 'sq ft'; quantity: number; rate_paise: number };
export type Job = {
  id: string;
  title: string;
  customer: string;
  due_on: string;
  fulfillment: string;
  lines: QuoteLine[];
  quoted_paise: number;
  paid_paise: number;
  stage: Stage;
  proof_history: string[];
};
type IceKind = 'receive' | 'sale' | 'count' | 'open' | 'close_day' | 'promise' | 'dispatch' | 'return';
type StoredIceKind = Exclude<IceKind, 'close_day'> | 'close' | 'waste';
export type IceInput = {
  kind: IceKind;
  site: string;
  sku: string;
  batch: string;
  unit: string;
  quantity: number;
  reference: string;
  detail: string;
  amount_paise: number;
  method: string;
  expiry: string;
};
export type Command =
  | IceInput
  | {
      kind: 'create';
      customer: string;
      title: string;
      due_on: string;
      fulfillment: string;
      lines: QuoteLine[];
    }
  | { kind: 'advance'; job_id: string; amount_paise: number }
  | { kind: 'proof'; job_id: string; detail: string }
  | { kind: 'progress'; job_id: string; expected_stage: Stage };
export type IceEvent = Omit<IceInput, 'amount_paise' | 'kind'> & {
  kind: StoredIceKind;
  id: string;
  day: string;
  delta: number;
  amount_paise?: number;
};
export type Stock = Pick<IceInput, 'site' | 'sku' | 'batch' | 'unit' | 'quantity'> & {
  expiry: string | null;
};
export type IceSeries = { day: string; unit: string; first: number | null; second: number | null };
export type Till = {
  site: string;
  staff: string | null;
  opening: number | null;
  cash: number;
  upi: number;
  counted: number | null;
};
export type Commitment = {
  reference: string;
  sku: string;
  customer: string;
  promised: number;
  dispatched: number;
};
export type Snapshot = {
  today: string;
  jobs?: Job[];
  stock?: Stock[];
  events?: IceEvent[];
  series: number[] | IceSeries[];
  tills?: Till[];
  orders?: Commitment[];
};
type LocalData = { jobs: Job[]; events: IceEvent[]; operations: Record<string, string> };

export const tradeDay = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function shiftDay(day: string, offset: number) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function quoteTotal(lines: QuoteLine[]) {
  return lines.reduce(
    (total, line) => total + Math.round((Math.round(line.quantity * 100) * line.rate_paise) / 100),
    0,
  );
}
const normalize = (value: string) => value.trim().toUpperCase();
const iceKey = (event: Pick<IceInput, 'site' | 'sku' | 'batch' | 'unit'>) =>
  JSON.stringify([event.site, event.sku, event.batch, event.unit]);
const orderKey = (event: IceEvent) => JSON.stringify([event.reference, event.sku]);
const sum = (values: IceEvent[], kind: StoredIceKind) =>
  values.reduce((total, row) => total + (row.kind === kind ? row.quantity : 0), 0);

function stockByBin(events: IceEvent[]) {
  const bins = new Map<string, Stock>();
  for (const { site, sku, batch, unit, delta, expiry } of events) {
    if (!sku) continue;
    const key = iceKey({ site, sku, batch, unit });
    const current = bins.get(key) ?? { site, sku, batch, unit, quantity: 0, expiry: null };
    current.quantity += delta;
    if (expiry) current.expiry = expiry;
    bins.set(key, current);
  }
  return bins;
}

export function localSnapshot(tool: SpecialtyToolId, data: LocalData, today: string): Snapshot {
  if (tool === 'banner-print-studio') {
    const series = [0, 0, 0, 0];
    for (const job of data.jobs) {
      if (job.stage === 'delivered') continue;
      series[
        job.due_on < today ? 0 : job.due_on === today ? 1 : job.due_on <= shiftDay(today, 7) ? 2 : 3
      ]++;
    }
    const jobs = [...data.jobs].sort(
      (a, b) =>
        Number(a.stage === 'delivered') - Number(b.stage === 'delivered') ||
        a.due_on.localeCompare(b.due_on),
    );
    return { today, jobs: jobs.slice(0, 100), series };
  }
  const stock = [...stockByBin(data.events).values()].filter((bin) => bin.quantity > 0);
  const grouped = new Map<string, IceSeries>();
  const tills = new Map<string, Till>();
  const orders = new Map<string, Commitment>();
  const firstKind = tool === 'ice-cream-stalls' ? 'receive' : 'promise';
  const secondKind = tool === 'ice-cream-stalls' ? 'sale' : 'dispatch';
  for (const event of data.events) {
    if (event.day >= shiftDay(today, -6) && (event.kind === firstKind || event.kind === secondKind)) {
      const key = event.day + ':' + event.unit;
      const point = grouped.get(key) ?? { day: event.day, unit: event.unit, first: 0, second: 0 };
      if (event.kind === firstKind)
        point.first = (point.first ?? 0) + event.quantity;
      else point.second = (point.second ?? 0) + event.quantity;
      grouped.set(key, point);
    }
    if (tool === 'ice-cream-stalls' && event.day === today) {
      const till = tills.get(event.site) ?? {
        site: event.site, staff: null, opening: null, cash: 0, upi: 0, counted: null,
      };
      if (event.kind === 'open') {
        till.opening = event.amount_paise ?? 0;
        till.staff = event.detail;
      }
      if (event.kind === 'sale' && event.method === 'cash') till.cash += event.amount_paise ?? 0;
      if (event.kind === 'sale' && event.method === 'upi') till.upi += event.amount_paise ?? 0;
      if (event.kind === 'close') till.counted = event.amount_paise ?? 0;
      tills.set(event.site, till);
    }
    if (event.kind === 'promise' || event.kind === 'dispatch') {
      const key = orderKey(event);
      const order = orders.get(key) ?? {
        reference: event.reference,
        sku: event.sku,
        customer: '',
        promised: 0,
        dispatched: 0,
      };
      if (event.kind === 'promise') {
        order.promised += event.quantity;
        order.customer = event.detail;
      } else order.dispatched += event.quantity;
      orders.set(key, order);
    }
  }
  return {
    today,
    stock,
    series: [...grouped.values()],
    tills: [...tills.values()],
    orders: [...orders.values()].filter((order) => order.promised > order.dispatched),
    events: data.events.slice(-50).reverse(),
  };
}

export function addLocalOperation(
  tool: SpecialtyToolId,
  data: LocalData,
  command: Command,
  id: string,
  today: string,
) {
  const encoded = JSON.stringify(command);
  if (data.operations[id]) {
    if (data.operations[id] !== encoded)
      throw new Error('Request was already used with different details');
    return;
  }
  if (command.kind === 'create') {
    if (
      !command.title ||
      !command.customer ||
      command.lines.some((line) => !line.label || line.rate_paise < 1)
    ) {
      throw new Error('Enter a customer, job name, and valid quote lines');
    }
    data.jobs.push({
      ...command,
      id,
      stage: 'design',
      quoted_paise: quoteTotal(command.lines),
      paid_paise: 0,
      proof_history: [],
    });
  } else if (command.kind === 'proof' || command.kind === 'advance' || command.kind === 'progress') {
    const job = data.jobs.find((entry) => entry.id === command.job_id);
    if (!job) throw new Error('Print job was not found');
    if (command.kind === 'proof') {
      if (!['design', 'proof'].includes(job.stage) || !command.detail || job.proof_history.length >= 50)
        throw new Error('Record an artwork reference while the job is in design or proof');
      job.stage = 'proof';
      job.proof_history.push(command.detail);
    } else if (command.kind === 'progress') {
      const next = stages[stages.indexOf(job.stage) + 1];
      if (!next || job.stage === 'design' || job.stage !== command.expected_stage)
        throw new Error('The job stage changed. Refresh the board');
      job.stage = next;
    } else {
      if (command.amount_paise < 1 || command.amount_paise > job.quoted_paise - job.paid_paise)
        throw new Error('Payment exceeds the remaining balance or is zero');
      job.paid_paise += command.amount_paise;
    }
  } else {
    const { kind, quantity, detail } = command;
    const event: IceEvent = {
      ...command,
      kind: kind === 'close_day' ? 'close' : kind,
      id,
      day: today,
      site: normalize(command.site),
      sku: normalize(command.sku),
      batch: normalize(command.batch),
      reference: normalize(command.reference),
      delta: 0,
    };
    if (tool === 'ice-cream-stalls') {
      const todayAtStall = data.events.filter((row) => row.day === today && row.site === event.site);
      const opened = todayAtStall.some((row) => row.kind === 'open');
      if (todayAtStall.some((row) => row.kind === 'close'))
        throw new Error('This stall is already closed for today');
      if (kind === 'open' || kind === 'close_day') {
        if (!event.site || !Number.isSafeInteger(command.amount_paise) || command.amount_paise < 0 || command.amount_paise > 10000000000)
          throw new Error('Check the stall name and cash amount');
        event.detail = detail.trim();
      }
      if (kind === 'open') {
        if (opened) throw new Error('This stall is already open for today');
        if (!event.detail || event.detail.length > 120) throw new Error('Enter the staff member’s name');
      }
      if (kind === 'close_day' && !opened) throw new Error('Record opening cash before closing this stall');
    }
    const bin = stockByBin(data.events).get(iceKey(event));
    const available = bin?.quantity ?? 0;
    if (kind === 'receive' || (kind === 'return' && detail === 'Restock')) event.delta = quantity;
    if (['sale', 'dispatch'].includes(kind)) event.delta = -quantity;
    if (kind === 'count') event.delta = quantity - available;
    if (available + event.delta < 0)
      throw new Error('Quantity exceeds stock available at this location');
    if (tool === 'ice-cream-distribution') {
      const linked = data.events.filter((row) => orderKey(row) === orderKey(event));
      if (
        kind === 'promise' &&
        data.events.some(
          (row) =>
            row.kind === 'promise' &&
            row.reference === event.reference &&
            normalize(row.detail) !== normalize(detail),
        )
      ) {
        throw new Error('Reuse the same customer for this order reference');
      }
      if (kind === 'receive' && (event.expiry < today || (bin?.expiry && bin.expiry !== event.expiry)))
        throw new Error('Batch expiry is past or conflicts with the existing batch');
      if (kind === 'dispatch') {
        if (!bin?.expiry || bin.expiry < today)
          throw new Error('Only stock within its recorded expiry date can be dispatched');
        if (quantity > sum(linked, 'promise') - sum(linked, 'dispatch'))
          throw new Error('Dispatch quantity exceeds the unshipped commitment');
      }
      if (kind === 'return') {
        const batch = linked.filter((row) => row.batch === event.batch);
        if (quantity > sum(batch, 'dispatch') - sum(batch, 'return'))
          throw new Error('Return exceeds shipped cases for this batch and order');
        if (detail === 'Restock' && (!bin?.expiry || bin.expiry < today))
          throw new Error('Restock only at a freezer with the same unexpired batch on record');
      }
    }
    data.events.push(event);
  }
  data.operations[id] = encoded;
}

function readLocal(key: string): LocalData {
  const saved = localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as LocalData) : { jobs: [], events: [], operations: {} };
}

export async function readOperations(
  org: string,
  tool: SpecialtyToolId,
  demo: boolean,
): Promise<Snapshot> {
  if (demo) return localSnapshot(tool, readLocal(`atlas-ops/${org}/${tool}`), tradeDay());
  const { data, error } = await getSupabaseClient().rpc('industry_workspace', {
    p_org: org,
    p_tool: tool,
  });
  if (error) throw new Error(error.message);
  return data as Snapshot;
}

export async function saveOperation(
  org: string,
  tool: SpecialtyToolId,
  demo: boolean,
  command: Command,
  id: string,
) {
  if (!demo) {
    const { error } = await getSupabaseClient().rpc('apply_industry_operation', {
      p_org: org,
      p_tool: tool,
      p_id: id,
      p_command: command,
    });
    if (error) throw new Error(error.message);
    return;
  }
  const key = `atlas-ops/${org}/${tool}`;
  const save = () => {
    const data = readLocal(key);
    addLocalOperation(tool, data, command, id, tradeDay());
    localStorage.setItem(key, JSON.stringify(data));
  };
  if (navigator.locks) await navigator.locks.request(key, save);
  else save();
}
