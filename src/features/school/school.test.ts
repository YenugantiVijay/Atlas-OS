import { describe, expect, it, vi, beforeEach } from 'vitest';
import { previewSchoolImport, schoolImportHeaders } from './school-import';
import { parseSchoolMoney, parseSchoolTax, schoolService, SchoolUnconfirmedError } from './school.service';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
const csv = (rows: string[]) => '\uFEFF' + schoolImportHeaders.join(',') + '\r\n' + rows.join('\r\n');
const student = 's-1,"Asha, Student",2016-02-29,Guardian,+91 9000000000,guardian@example.com,School Road,Prior School,2026-06-01';
describe('School imports and exact amounts', () => {
  it('parses BOM, quoted names and a real leap date, and normalizes admission IDs', () => {
    const result = previewSchoolImport(csv([student]), 'class-a', '2026-11-27');
    expect(result.errors).toEqual([]); expect(result.rows[0]).toMatchObject({ admission_no: 'S-1', name: 'Asha, Student', class_id: 'class-a' });
  });
  it('rejects duplicate IDs from the batch and existing school records', () => {
    expect(previewSchoolImport(csv([student, student]), 'class-a', '2026-11-27').errors).toContain('Row 3: duplicate admission number.');
    expect(previewSchoolImport(csv([student]), 'class-a', '2026-11-27', ['S-1']).errors).toContain('Row 2: duplicate admission number.');
  });
  it('rejects invalid calendar dates and birth dates after joining', () => {
    expect(previewSchoolImport(csv([student.replace('2016-02-29', '2017-02-29')]), 'class-a', '2026-11-27').errors.join()).toContain('date of birth');
    expect(previewSchoolImport(csv([student.replace('2016-02-29', '2026-07-01')]), 'class-a', '2026-11-27').errors.join()).toContain('date of birth');
  });
  it('rejects malformed quotes, oversized batches and files before committing', () => {
    expect(() => previewSchoolImport(csv([student.replace('"Asha, Student"', '"Asha"oops')]), 'class-a', '2026-11-27')).toThrow(/quoted CSV/);
    expect(() => previewSchoolImport(csv(Array(201).fill(student)), 'class-a', '2026-11-27')).toThrow(/200/);
    expect(() => previewSchoolImport('x'.repeat(250001), 'class-a', '2026-11-27')).toThrow(/250 KB/);
  });
  it('accepts only exact positive money and bounded tax rates', () => {
    expect(parseSchoolMoney('1000.01')).toBe(100001); expect(parseSchoolTax('18')).toBe(1800); expect(parseSchoolTax('0')).toBe(0);
    for (const value of ['0', '-1', '1.001', '1e3']) expect(() => parseSchoolMoney(value)).toThrow();
    for (const value of ['-1', '100.01', '18.001']) expect(() => parseSchoolTax(value)).toThrow();
  });
});
describe('School RPC confirmation and complete exports', () => {
  beforeEach(() => rpc.mockReset());
  it('preserves the request identity in the server command', async () => {
    rpc.mockResolvedValue({ data: { receipt_id: 'receipt-a' }, error: null });
    await expect(schoolService.command('org-a', 'payment', { amount_paise: 101 }, 'request-a')).resolves.toEqual({ receipt_id: 'receipt-a' });
    expect(rpc).toHaveBeenCalledWith('school_command', { p_org_id: 'org-a', p_action: 'payment', p_data: { amount_paise: 101 }, p_request_id: 'request-a' });
  });
  it('treats missing acknowledgement and rejected network promises as uncertain writes', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockRejectedValueOnce(new Error('connection lost'));
    await expect(schoolService.command('org-a','payment',{},'request-a')).rejects.toBeInstanceOf(SchoolUnconfirmedError);
    await expect(schoolService.command('org-a','payment',{},'request-a')).rejects.toBeInstanceOf(SchoolUnconfirmedError);
  });
  it('fails closed for read errors, unsafe financial amounts and truncated exports', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    await expect(schoolService.read('org-a','charges')).rejects.toThrow(/permissions/);
    rpc.mockResolvedValueOnce({ data: { rows: [{ balance_paise: Number.MAX_SAFE_INTEGER + 1 }] }, error: null });
    await expect(schoolService.read('org-a','charges')).rejects.toThrow(/exactly/);
    rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'first' }], count: 26 }, error: null });
    await expect(schoolService.read('org-a','fee_summary',{export:true})).rejects.toThrow(/export/);
    rpc.mockResolvedValueOnce({ data: { rows: [{ id: 'first' }], count: 1 }, error: null });
    await expect(schoolService.read('org-a','fee_summary',{export:true})).resolves.toMatchObject({ count: 1 });
  });
});
