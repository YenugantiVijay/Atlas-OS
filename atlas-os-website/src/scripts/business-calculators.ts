const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const percent = (value: number) => value.toFixed(2) + '%';
type Result = [label: string, value: string];

export function estimateIncomeTax(income: number, regime: 'old' | 'new') {
  const modern = regime === 'new';
  const bands = modern ? [[400000, 0], [800000, .05], [1200000, .1], [1600000, .15], [2000000, .2], [2400000, .25], [Infinity, .3]]
    : [[250000, 0], [500000, .05], [1000000, .2], [Infinity, .3]];
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of bands) {
    tax += Math.max(0, Math.min(income, upper) - lower) * rate;
    lower = upper;
  }
  const rebateLimit = modern ? 1200000 : 500000;
  const rebate = income <= rebateLimit ? Math.min(tax, modern ? 60000 : 12500) : 0;
  const relief = modern && income > rebateLimit ? Math.max(0, tax - (income - rebateLimit)) : 0;
  const afterRelief = tax - rebate - relief;
  return { tax, rebate, relief, cess: afterRelief * .04, total: afterRelief * 1.04 };
}

function readNumber(data: FormData, field: string) {
  const raw = String(data.get(field) ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('Enter valid numbers with up to two decimal places.');
  const value = Number(raw);
  if (value > 999999999.99) throw Error('Enter a smaller value.');
  return value;
}

export function calculateBusinessTool(tool: string, form: FormData): Result[] {
  const n = (name: string) => readNumber(form, name);
  switch (tool) {
    case 'income-tax': {
      const oldIncome = n('oldIncome');
      const newIncome = n('newIncome');
      if (Math.max(oldIncome, newIncome) > 5000000) throw Error('This estimate supports taxable income up to ₹50 lakh under each regime.');
      const old = estimateIncomeTax(oldIncome, 'old');
      const modern = estimateIncomeTax(newIncome, 'new');
      return [['Old regime including cess', money.format(old.total)], ['New regime including cess', money.format(modern.total)],
        ['Old regime rebate', money.format(old.rebate)], ['New regime rebate or marginal relief', money.format(modern.rebate + modern.relief)]];
    }
    case 'gstin-check': {
      const id = String(form.get('gstin') ?? '').trim().toUpperCase();
      if (!id) throw Error('Enter a GSTIN to check its format.');
      return [['Format check', /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z\d]$/.test(id) ? 'Matches the standard format' : 'Does not match the standard format']];
    }
    case 'input-tax-credit': {
      const credit = n('igst') + n('cgst') + n('regional');
      const reversals = n('reversals');
      if (reversals > credit) throw Error('Reversals exceed the credit entered.');
      return [['Credit entered', money.format(credit)], ['Reversals', money.format(reversals)], ['Net credit estimate', money.format(credit - reversals)]];
    }
    case 'profit-margin': {
      const cost = n('cost');
      const sales = n('sale');
      const profit = sales - cost;
      return [['Gross profit', money.format(profit)], ['Gross margin', sales > 0 ? percent(profit / sales * 100) : 'Undefined at zero sales'],
        ['Markup', cost > 0 ? percent(profit / cost * 100) : 'Undefined at zero cost']];
    }
    case 'emi': {
      const principal = n('principal');
      const annualRate = n('interest');
      const months = n('months');
      if (annualRate > 100 || months < 1 || months > 600 || !Number.isInteger(months)) throw Error('Enter a rate from 0 to 100% and a whole term from 1 to 600 months.');
      const monthlyRate = annualRate / 1200;
      const payment = monthlyRate === 0 ? principal / months : principal * monthlyRate / -Math.expm1(-months * Math.log1p(monthlyRate));
      return [['Monthly EMI', money.format(payment)], ['Total interest', money.format(Math.max(0, payment * months - principal))], ['Total repaid', money.format(payment * months)]];
    }
    case 'inventory-turnover': {
      const average = (n('opening') + n('closing')) / 2;
      const cost = n('cogs');
      return [['Average inventory', money.format(average)], ['Inventory turnover', average > 0 ? (cost / average).toFixed(2) + ' times' : 'Undefined at zero inventory'],
        ['Days of inventory', average > 0 && cost > 0 ? (365 * average / cost).toFixed(1) + ' days' : 'Unavailable']];
    }
    case 'annual-tax-balance': {
      const liability = n('liability');
      const payments = n('tds') + n('advance') + n('selfAssessment');
      return [['Tax payments entered', money.format(payments)], ['Estimated balance due', money.format(Math.max(0, liability - payments))],
        ['Estimated excess paid', money.format(Math.max(0, payments - liability))]];
    }
    default:
      throw Error('This calculator is unavailable.');
  }
}
