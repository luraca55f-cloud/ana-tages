import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

const errors = [];
const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.css'];
const resolvableExts = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.css'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function packageName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

function resolveLocal(fromFile, rawSpec) {
  const spec = rawSpec.split('?')[0].split('#')[0];
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  for (const ext of resolvableExts) candidates.push(base + ext);
  for (const ext of resolvableExts.slice(1)) candidates.push(path.join(base, `index${ext}`));
  return candidates.some((candidate) => fs.existsSync(candidate));
}

const files = walk(path.join(root, 'src')).filter((file) => sourceExts.includes(path.extname(file)));
const importPattern = /(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]+?\s+from\s+|import\s*\()(['\"])([^'\"]+)\1/g;
const cssImportPattern = /@import\s+['\"]([^'\"]+)['\"]/g;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll('\\', '/');

  if (text.includes('"@/') || text.includes("'@/")) {
    errors.push(`${rel}: alias @/ proibido no CLEAN START; use import relativo.`);
  }

  if (path.extname(file) === '.css') {
    for (const match of text.matchAll(cssImportPattern)) {
      const spec = match[1];
      if (spec.startsWith('.') && !resolveLocal(file, spec)) {
        errors.push(`${rel}: CSS import local não encontrado: ${spec}`);
      } else if (!spec.startsWith('.') && !declared.has(packageName(spec))) {
        errors.push(`${rel}: pacote CSS não declarado no package.json: ${packageName(spec)}`);
      }
    }
    continue;
  }

  for (const match of text.matchAll(importPattern)) {
    const spec = match[2];
    if (spec.startsWith('.') && !resolveLocal(file, spec)) {
      errors.push(`${rel}: import local não encontrado: ${spec}`);
    } else if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:')) {
      const base = packageName(spec);
      if (!declared.has(base)) errors.push(`${rel}: pacote não declarado no package.json: ${base}`);
    }
  }
}

function majorMinor(version) {
  const match = String(version ?? '').match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

if (pkg.dependencies?.react !== pkg.dependencies?.['react-dom']) {
  errors.push('package.json: react e react-dom devem estar na mesma versão exata.');
}
if (majorMinor(pkg.devDependencies?.['@types/react']) !== majorMinor(pkg.devDependencies?.['@types/react-dom'])) {
  errors.push('package.json: @types/react e @types/react-dom devem usar a mesma família major.minor.');
}

const migration = path.join(root, 'supabase', 'migrations', '202609220001_initial_schema.sql');
if (!fs.existsSync(migration)) {
  errors.push('Migração principal do Supabase não encontrada.');
} else {
  const sql = fs.readFileSync(migration, 'utf8');
  const oldBrokenExpression = 'tstzrange(scheduled_at, scheduled_at + make_interval(mins => duration_minutes)';
  if (sql.includes(oldBrokenExpression)) {
    errors.push('Migração SQL contém a antiga expressão de índice/exclusion constraint que causava ERROR 42P17.');
  }
  if (!sql.includes('pg_advisory_xact_lock') || !sql.includes('prevent_appointment_overlap')) {
    errors.push('Migração SQL não contém a correção de concorrência/sobreposição esperada.');
  }
}

if (fs.existsSync(path.join(root, '.github'))) {
  errors.push('CLEAN START não deve carregar workflows antigos do GitHub Actions.');
}
if (fs.existsSync(path.join(root, 'package-lock.json'))) {
  errors.push('CLEAN START não deve carregar o package-lock.json antigo.');
}

if (errors.length) {
  console.error('\nFalhas de integridade do projeto:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Projeto íntegro: ${files.length} arquivos de fonte verificados; imports locais e dependências conferidos.`);
