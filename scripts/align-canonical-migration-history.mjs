import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const SUPABASE_CLI = 'C:\\Users\\VIJAY\\AppData\\Local\\npm-cache\\_npx\\aa8e5c70f9d8d161\\node_modules\\@supabase\\cli-windows-x64\\bin\\supabase.exe';

function runSql(sql) {
  const stdout = execFileSync(SUPABASE_CLI, ['db', 'query', '--linked', sql], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

// 1. Get local migrations 001 through 070 (the first 70 files)
const files = readdirSync('supabase/migrations')
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Found ${files.length} local migration files.`);
const first70 = files.slice(0, 70);

let updateStatements = `BEGIN;\n`;

for (let i = 0; i < first70.length; i++) {
  const file = first70[i];
  const match = /^(\d{3}|\d{14})_(.+)\.sql$/.exec(file);
  if (!match) continue;
  const [, canonicalVersion, baseName] = match;

  // Update remote row where name contains baseName or file name
  updateStatements += `UPDATE supabase_migrations.schema_migrations 
    SET version = '${canonicalVersion}', name = '${baseName}'
    WHERE name LIKE '%${baseName}%' OR name = '${file.replace('.sql', '')}';\n`;
}

updateStatements += `COMMIT;\n`;

console.log('Aligning remote migration history to canonical versions...');
const result = runSql(updateStatements);
console.log('Result:', result);
