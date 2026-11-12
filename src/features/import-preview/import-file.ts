export interface SourceRow {
  number: number;
  cells: string[];
  cellIssues?: Record<number, 'formula' | 'error' | 'long-number'>;
}

export interface SourceSheet {
  name: string;
  rows: SourceRow[];
}

export const MAX_IMPORT_ROWS = 20_000;
const MAX_COLUMNS = 80;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function csvDelimiter(text: string): string {
  const choices = [',', '\t', ';'];
  const scores = [0, 0, 0];
  const seen = [false, false, false];
  let inQuotes = false;
  let fieldStart = true;
  let rows = 0;
  for (let index = 0; index < text.length && rows < 30; index++) {
    const character = text[index];
    if (character === '"' && (inQuotes || fieldStart)) {
      if (inQuotes && text[index + 1] === '"') index++;
      else inQuotes = !inQuotes;
      fieldStart = false;
    } else if (!inQuotes) {
      if (character === '\n') {
        seen.forEach((present, choice) => { if (present) scores[choice]++; });
        seen.fill(false);
        rows++;
        fieldStart = true;
      } else {
        const choice = choices.indexOf(character);
        if (choice !== -1) {
          seen[choice] = true;
          fieldStart = true;
        } else if (character.trim()) fieldStart = false;
      }
    }
  }
  seen.forEach((present, choice) => { if (present) scores[choice]++; });
  return choices[scores.indexOf(Math.max(...scores))];
}

export function parseDelimitedSheet(contents: string, name: string): SourceSheet {
  const normalized = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const directive = /^sep=([,;\t])(?:\n|$)/i.exec(normalized);
  const text = directive ? normalized.slice(directive[0].length) : normalized;
  const delimiter = directive?.[1] ?? csvDelimiter(text);
  const rows: SourceRow[] = [];
  let line = directive ? 2 : 1;
  let rowStart = line;
  let cells: string[] = [];
  let value = '';
  let inQuotes = false;
  let closedQuote = false;

  const pushCell = () => {
    if (cells.length === MAX_COLUMNS) throw new Error(`A source sheet can have up to ${MAX_COLUMNS} columns.`);
    cells.push(value.trim());
    value = '';
    closedQuote = false;
  };

  const pushRow = () => {
    pushCell();
    if (cells.some(Boolean)) {
      if (rows.length === MAX_IMPORT_ROWS) throw new Error(`A file can have up to ${MAX_IMPORT_ROWS.toLocaleString()} populated rows.`);
      rows.push({ number: rowStart, cells });
    }
    cells = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        value += character;
        if (character === '\n') line++;
      }
    } else if (character === delimiter) {
      pushCell();
    } else if (character === '\n') {
      pushRow();
      rowStart = ++line;
    } else if (closedQuote) {
      if (character.trim()) throw new Error(`Unexpected text after a quoted field on line ${line}.`);
    } else if (character === '"' && !value.trim()) {
      value = '';
      inQuotes = true;
    } else {
      value += character;
    }
  }
  if (inQuotes) throw new Error(`A quoted field starting on line ${rowStart} is incomplete.`);
  if (value || cells.length || closedQuote) pushRow();
  if (rows.length === 0) throw new Error('This file does not contain any populated rows.');
  return { name, rows };
}

async function verifyEntrySize(buffer: ArrayBuffer, start: number, compressedSize: number, expectedSize: number) {
  let stream: DecompressionStream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('This browser could not open the compressed workbook. Save the sheet as CSV and try again.');
  }
  const reader = new Blob([buffer.slice(start, start + compressedSize)]).stream().pipeThrough(stream).getReader();
  let actualSize = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      actualSize += chunk.value.byteLength;
      if (actualSize > expectedSize) throw new Error('Workbook entry exceeds its recorded size.');
    }
    if (actualSize !== expectedSize) throw new Error('Workbook entry size does not match its recorded size.');
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error('The compressed workbook contents could not be verified. Export the file again.');
  } finally {
    reader.releaseLock();
  }
}

async function verifyWorkbookArchive(buffer: ArrayBuffer) {
  const bytes = new DataView(buffer);
  let end = bytes.byteLength - 22;
  const earliest = Math.max(0, end - 65_535);
  while (end >= earliest && (bytes.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + bytes.getUint16(end + 20, true) !== bytes.byteLength)) end--;
  if (end < earliest || bytes.getUint32(end + 4, true) !== 0) throw new Error('This file is not a readable .xlsx workbook.');

  const entries = bytes.getUint16(end + 10, true);
  const centralSize = bytes.getUint32(end + 12, true);
  const centralOffset = bytes.getUint32(end + 16, true);
  let offset = centralOffset;
  if (entries === 0 || entries > 512 || bytes.getUint16(end + 8, true) !== entries ||
      offset + centralSize !== end) throw new Error('This workbook exceeds the supported archive layout.');

  let expandedSize = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || bytes.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('The workbook archive is incomplete.');
    }
    const compressedSize = bytes.getUint32(offset + 20, true);
    const entrySize = bytes.getUint32(offset + 24, true);
    const localOffset = bytes.getUint32(offset + 42, true);
    const method = bytes.getUint16(offset + 10, true);
    expandedSize += entrySize;
    if (expandedSize > MAX_ARCHIVE_BYTES) throw new Error('This workbook is too large when expanded. Split it into smaller exports.');
    if (localOffset + 30 > centralOffset || bytes.getUint32(localOffset, true) !== 0x04034b50 ||
        bytes.getUint16(localOffset + 8, true) !== method ||
        (bytes.getUint16(offset + 8, true) & 1) || (method !== 0 && method !== 8)) {
      throw new Error('The workbook contains an unsupported archive entry.');
    }
    const dataStart = localOffset + 30 + bytes.getUint16(localOffset + 26, true) + bytes.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > centralOffset || (method === 0 && compressedSize !== entrySize)) {
      throw new Error('The workbook archive layout is inconsistent.');
    }
    if (method === 8) await verifyEntrySize(buffer, dataStart, compressedSize, entrySize);
    offset += 46 + bytes.getUint16(offset + 28, true) +
      bytes.getUint16(offset + 30, true) + bytes.getUint16(offset + 32, true);
  }
  if (offset !== end) throw new Error('The workbook archive layout is inconsistent.');
}

export async function readImportFile(file: File): Promise<SourceSheet[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Choose an .xlsx or .csv file. For older .xls files, use Save As in Excel.');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('This export exceeds 10 MB. Split it into smaller files.');
  const buffer = await file.arrayBuffer();
  if (extension === 'csv') {
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' :
      bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let contents: string;
    try {
      contents = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      throw new Error('Save this CSV with UTF-8 encoding and try again.');
    }
    return [parseDelimitedSheet(contents, file.name)];
  }

  await verifyWorkbookArchive(buffer);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer, { ignoreNodes: ['mergeCells', 'dataValidations', 'conditionalFormatting', 'drawing', 'picture', 'extLst', 'hyperlinks'] });
  } catch {
    throw new Error('This workbook could not be read. Export it again as an unprotected .xlsx file.');
  }

  let totalRows = 0;
  const sheets: SourceSheet[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue;
    const rows: SourceRow[] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      const cellIssues: NonNullable<SourceRow['cellIssues']> = {};
      row.eachCell((cell, column) => {
        if (cell.type === ExcelJS.ValueType.Merge) return;
        if (column > MAX_COLUMNS) throw new Error(`A source sheet can have up to ${MAX_COLUMNS} columns.`);
        const value = cell.value;
        const index = column - 1;
        if (cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error) {
          cellIssues[index] = cell.type === ExcelJS.ValueType.Formula ? 'formula' : 'error';
          cells[index] = '';
          return;
        }
        const format = cell.numFmt?.replace(/"[^"]*"|\\./g, '') ?? '';
        if (typeof value === 'number' && format.includes('%')) {
          cells[index] = Number((value * 100).toPrecision(15)) + '%';
        } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && /^0{2,30}$/.test(cell.numFmt)) {
          cells[index] = String(value).padStart(cell.numFmt.length, '0');
        } else cells[index] = cell.text.trim();
        if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) >= 1e15) {
          cellIssues[index] = 'long-number';
        }
      });
      if (cells.some(Boolean) || Object.keys(cellIssues).length) {
        if (++totalRows > MAX_IMPORT_ROWS) throw new Error(`A file can have up to ${MAX_IMPORT_ROWS.toLocaleString()} populated rows.`);
        rows.push({ number: row.number, cells, cellIssues });
      }
    });
    if (rows.length) sheets.push({ name: sheet.name, rows });
  }
  if (sheets.length === 0) throw new Error('This workbook does not contain a populated visible sheet.');
  return sheets;
}
