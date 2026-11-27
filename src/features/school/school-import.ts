export interface SchoolImportRow {
  admission_no: string; name: string; dob: string; guardian_name: string; guardian_phone: string;
  guardian_email: string; address: string; previous_school: string; joining_on: string; class_id: string;
}
export const schoolImportHeaders = ['admission_no', 'name', 'dob', 'guardian_name', 'guardian_phone', 'guardian_email', 'address', 'previous_school', 'joining_on'];
function readCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false; let closed = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (!quoted && cell.length) throw new Error('A CSV quote appeared inside an unquoted cell.');
      else { quoted = !quoted; if (!quoted) closed = true; }
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; closed = false; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; closed = false;
    } else { if (closed && !quoted && char.trim()) throw new Error('Unexpected text after a quoted CSV cell.'); if (!closed || quoted) cell += char; }
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted cell.');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function previewSchoolImport(text: string, classId: string, today: string, existingIds: string[] = []) {
  if (!classId) throw new Error('Choose the academic class before previewing students.');
  if (new TextEncoder().encode(text).length > 250000) throw new Error('Use a CSV file smaller than 250 KB.');
  const csv = readCsv(text);
  const headers = csv.shift()?.map(value => value.trim().toLowerCase()) ?? [];
  if (headers.length !== schoolImportHeaders.length || schoolImportHeaders.some(header => !headers.includes(header)) || new Set(headers).size !== headers.length) {
    throw new Error('Use the student CSV template headers exactly.');
  }
  if (csv.length < 1 || csv.length > 200) throw new Error('Import between 1 and 200 students at a time.');
  const seen = new Set(existingIds.map(id => id.toUpperCase()));
  const errors: string[] = [];
  const rows = csv.map((cells, index) => {
    const row = Object.fromEntries(headers.map((key, cellIndex) => [key, (cells[cellIndex] ?? '').trim()])) as unknown as SchoolImportRow;
    const fail = (message: string) => errors.push(`Row ${index + 2}: ${message}`);
    if (cells.length !== headers.length) fail('column count does not match the template.');
    row.admission_no = row.admission_no.toUpperCase(); row.class_id = classId;
    if (!row.admission_no || row.admission_no.length > 40) fail('admission number is required (up to 40 characters).');
    if (seen.has(row.admission_no)) fail('duplicate admission number.');
    seen.add(row.admission_no);
    if (!row.name || row.name.length > 150 || !row.guardian_name || row.guardian_name.length > 150) fail('student and guardian names are required (up to 150 characters).');
    if (!/^[+\d ()-]{5,30}$/.test(row.guardian_phone)) fail('check the guardian phone number.');
    if (!validDate(row.joining_on)) fail('joining date must be YYYY-MM-DD.');
    if (row.dob && (!validDate(row.dob) || row.dob > today || row.dob > row.joining_on)) fail('check date of birth.');
    if (row.guardian_email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.guardian_email) || row.guardian_email.length > 150)) fail('check the guardian email.');
    if (row.address.length > 1000 || row.previous_school.length > 150) fail('address or previous school is too long.');
    return row;
  });
  return { rows, errors };
}
