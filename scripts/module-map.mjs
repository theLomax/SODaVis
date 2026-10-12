#!/usr/bin/env node
/**
 * Writes docs/generated/module-map.md: every source module with its one-line
 * purpose, size band, exports, and who imports whom.
 *
 * Generated rather than written so it cannot drift from the code — the hand-written
 * docs/architecture.md carries the *why*, this carries the *what*. Read it before
 * scanning the tree: it answers "where does X live" and "what depends on Y" for a
 * fraction of the tokens.
 *
 * Usage:
 *   npm run map            # rewrite the file
 *   npm run map -- --check # exit 1 if it is out of date (what the test runs)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const OUT = join(ROOT, 'docs', 'generated', 'module-map.md')

const posix = (p) => p.split(sep).join('/')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [full] : []
  })
}

/** S under 200 lines, M under 500, L from 500: how costly a file is to read whole. */
function sizeBand(lines) {
  return lines < 200 ? 'S' : lines < 500 ? 'M' : 'L'
}

/** First sentence of the file's leading /** *\/ comment, or ''. */
function purpose(sf) {
  const text = sf.getFullText()
  const range = ts.getLeadingCommentRanges(text, 0)?.find((r) => text.slice(r.pos, r.pos + 3) === '/**')
  if (!range) return ''
  const body = text
    .slice(range.pos + 3, range.end - 2)
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Whole sentences, so a terse opener ("Data access.") takes the next one with it.
  // A sentence ends at . ! or ? followed by a space and a capital — not at the dot
  // in `.xlsx` or "4.1".
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z"`(*])/).map((x) => x.trim())
  let first = sentences[0] ?? ''
  if (first.length < 40 && sentences[1]) first = `${first} ${sentences[1]}`
  first = first.replace(/\|/g, '\\|')
  return first.length > 160 ? `${first.slice(0, 157)}…` : first
}

function hasExport(node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function exportsOf(sf) {
  const out = []
  for (const node of sf.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) out.push(`${el.name.text} (re-export)`)
      } else out.push('* (re-export)')
      continue
    }
    if (!hasExport(node)) continue
    const kind = ts.isFunctionDeclaration(node)
      ? 'fn'
      : ts.isClassDeclaration(node)
        ? 'class'
        : ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)
          ? 'type'
          : ts.isEnumDeclaration(node)
            ? 'enum'
            : 'const'
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) out.push(`${d.name.text}`)
    } else if (node.name) {
      out.push(kind === 'const' ? node.name.text : `${node.name.text}${kind === 'fn' ? '()' : kind === 'class' ? ' (class)' : ''}`)
    }
  }
  return out
}

function importsOf(sf, file) {
  const local = new Set()
  const pkgs = new Set()
  const add = (spec) => {
    if (spec.startsWith('.')) {
      let target = resolve(dirname(file), spec.replace(/\?.*$/, ''))
      for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
        try {
          if (statSync(target + ext).isFile()) {
            target = target + ext
            break
          }
        } catch {
          /* try the next extension */
        }
      }
      local.add(posix(relative(SRC, target)))
    } else if (!spec.startsWith('node:')) {
      pkgs.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    }
  }
  sf.forEachChild(function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text)
    }
    // `await import('xlsx')`: a dependency even though it loads lazily.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      add(node.arguments[0].text)
    }
    node.forEachChild(visit)
  })
  return { local: [...local].sort(), pkgs: [...pkgs].sort() }
}

export function buildModuleMap() {
  const files = walk(SRC).sort()
  const modules = files.map((file) => {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    return {
      path: posix(relative(SRC, file)),
      size: sizeBand(text.split('\n').length),
      purpose: purpose(sf),
      exports: exportsOf(sf),
      ...importsOf(sf, file),
    }
  })
  const importedBy = new Map(modules.map((m) => [m.path, []]))
  for (const m of modules) for (const dep of m.local) importedBy.get(dep)?.push(m.path)

  const byDir = new Map()
  for (const m of modules) {
    const dir = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/')) : '.'
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(m)
  }

  const lines = [
    '<!-- Generated by scripts/module-map.mjs. Do not edit; run `npm run map`. -->',
    '',
    '# Module map',
    '',
    'Every non-test module under `src/`: what it is for (its header comment\'s first sentence),',
    'its size band (**S** < 200 lines, **M** < 500, **L** ≥ 500 — how costly it is to read whole),',
    'what it exports, and its local imports and importers. Paths are relative to `src/`.',
    'For *why* the code is shaped this way, see `docs/architecture.md`.',
    '',
  ]
  for (const [dir, mods] of byDir) {
    lines.push(`## \`${dir}/\``, '')
    for (const m of mods) {
      lines.push(`### \`${m.path}\` · ${m.size}`, '')
      if (m.purpose) lines.push(m.purpose, '')
      if (m.exports.length) lines.push(`- **Exports:** ${m.exports.map((e) => `\`${e}\``).join(', ')}`)
      if (m.local.length) lines.push(`- **Imports:** ${m.local.map((p) => `\`${p}\``).join(', ')}`)
      if (m.pkgs.length) lines.push(`- **Packages:** ${m.pkgs.join(', ')}`)
      const by = importedBy.get(m.path) ?? []
      lines.push(`- **Imported by:** ${by.length ? by.map((p) => `\`${p}\``).join(', ') : '—'}`)
      lines.push('')
    }
  }
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = buildModuleMap()
  if (process.argv.includes('--check')) {
    let current = ''
    try {
      current = readFileSync(OUT, 'utf8')
    } catch {
      /* missing counts as stale */
    }
    if (current.replace(/\r\n/g, '\n') !== next) {
      console.error('docs/generated/module-map.md is out of date. Run: npm run map')
      process.exit(1)
    }
    console.log('module map is up to date')
  } else {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, next)
    console.log(`wrote ${posix(relative(ROOT, OUT))}`)
  }
}
