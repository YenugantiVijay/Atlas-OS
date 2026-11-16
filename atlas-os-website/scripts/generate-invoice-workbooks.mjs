import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const website = resolve(process.argv[2] ?? '.');
const previewFolder = process.argv[3];
const catalogue = JSON.parse(await readFile(join(website, 'src/data/invoice-formats.json'), 'utf8'));
const output = join(website, 'public/invoice-templates');
await mkdir(output, { recursive: true });

const dark = '#172D4C';
const teal = '#0F665D';
const pale = '#EDF6F2';
const entry = '#145B92';
const tealBand = { fill: teal, font: { bold: true, color: '#FFFFFF' } };

for (const template of catalogue) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Invoice');
  sheet.showGridLines = false;

  const title = sheet.getRange('A1:L1');
  title.merge();
  sheet.getRange('A1').values = [[template.name + ' sample invoice']];
  title.format = { ...tealBand, font: { ...tealBand.font, size: 17 }, rowHeight: 34 };
  sheet.getRange('A2:L2').merge();
  sheet.getRange('A2').values = [['Replace the sample details and tax rates before issuing. Enter the correct HSN/SAC and choose the applicable tax treatment.']];
  sheet.getRange('A2:L2').format = { rowHeight: 27, fill: pale, font: { color: dark } };

  const details = [
    ['Seller', '[Name, address, GSTIN]'],
    ['Bill to', '[Customer name, address, GSTIN if applicable]'],
    ['Invoice number', 'SAMPLE-001'],
    ['Invoice date', '[DD/MM/YYYY]'],
    ['Place of supply', '[State and code]'],
    ['Ship to', '[Delivery address if different]'],
    ['Reverse charge', '[Review as applicable]'],
    ['GST treatment', 'CGST + SGST'],
    ...template.fields.map(([label, hint]) => [label, '[' + hint + ']']),
  ];
  details.forEach(([label, value], index) => {
    const row = 4 + index;
    sheet.getRange(`A${row}`).values = [[label]];
    sheet.getRange(`B${row}:G${row}`).merge();
    sheet.getRange(`B${row}`).values = [[value]];
  });
  sheet.getRange('A4:A14').format.font = { bold: true, color: dark };
  sheet.getRange('B4:G14').format.font = { color: entry };
  sheet.getRange('B11').dataValidation = { rule: { type: 'list', values: ['CGST + SGST', 'CGST + UTGST', 'IGST', 'No GST'] }, inCellDropDown: true };

  sheet.getRange('A16:L16').values = [[
    'Description', 'HSN/SAC', 'Qty', 'Unit', 'Unit rate', 'GST rate', 'Taxable INR',
    'CGST INR', 'SGST/UTGST INR', 'IGST INR', 'Tax INR', 'Total INR',
  ]];
  sheet.getRange('A16:L16').format = { ...tealBand, rowHeight: 26 };
  const last = 26;
  for (let row = 17; row <= last; row++) {
    const line = template.lines[row - 17];
    if (line) {
      const [description, qty, unit, rate, percent] = line;
      sheet.getRange(`A${row}:F${row}`).values = [[description, '', qty, unit, rate, percent / 100]];
    }
    sheet.getRange(`G${row}:L${row}`).formulas = [[
      `=IF(A${row}="","",ROUND(C${row}*E${row},2))`,
      `=IF(A${row}="","",IF(OR($B$11="CGST + SGST",$B$11="CGST + UTGST"),ROUND(K${row}/2,2),0))`,
      `=IF(A${row}="","",IF(OR($B$11="CGST + SGST",$B$11="CGST + UTGST"),ROUND(K${row}-H${row},2),0))`,
      `=IF(A${row}="","",IF($B$11="IGST",K${row},0))`,
      `=IF(A${row}="","",IF(OR($B$11="CGST + SGST",$B$11="CGST + UTGST",$B$11="IGST"),ROUND(G${row}*F${row},2),IF($B$11="No GST",0,NA())))`,
      `=IF(A${row}="","",ROUND(G${row}+K${row},2))`,
    ]];
    if (row % 2 === 0) sheet.getRange(`A${row}:L${row}`).format.fill = pale;
  }
  sheet.getRange('A17:F26').format.font = { color: entry };
  sheet.getRange('F17:F26').setNumberFormat('0.00%');
  sheet.getRange('E17:E26').setNumberFormat('#,##0.00');
  sheet.getRange('G17:L30').setNumberFormat('#,##0.00');
  sheet.getRange('A27').values = [['Invoice totals']];
  sheet.getRange('G27:L27').formulas = [['G', 'H', 'I', 'J', 'K', 'L'].map(column => `=SUM(${column}17:${column}${last})`)];
  sheet.getRange('A27:L27').format = { ...tealBand, rowHeight: 24 };
  sheet.getRange('G27:L27').setNumberFormat('#,##0.00');
  sheet.getRange('K29:K30').values = [['Payments INR'], ['Balance INR']];
  sheet.getRange('L29').values = [[0]];
  sheet.getRange('L29').format.font = { color: entry };
  sheet.getRange('L30').formulas = [['=ROUND(L27-L29,2)']];
  sheet.getRange('A32:L32').merge();
  sheet.getRange('A32').values = [['Authorized signature  ______________________________________']];
  const widths = [235, 112, 58, 85, 90, 90, 105, 92, 123, 90, 105, 108];
  widths.forEach((width, index) => {
    const column = 'ABCDEFGHIJKL'[index];
    sheet.getRange(column + ':' + column).format.columnWidthPx = width;
  });
  sheet.getRange('A17:L26').format.rowHeight = 22;

  if (previewFolder && template.id === 'hotel') {
    await mkdir(previewFolder, { recursive: true });
    const preview = await workbook.render({ sheetName: 'Invoice', range: 'A1:L32', scale: 1, format: 'png' });
    await writeFile(join(previewFolder, 'hotel-excel.png'), new Uint8Array(await preview.arrayBuffer()));
  }
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  const file = join(output, template.id + '.xlsx');
  await xlsx.save(file);
  await rm(file + '.inspect.ndjson', { force: true });
}
