#!/usr/bin/env node
// One-shot scrubber: remove all "licensed", "insured", "licencia", "seguro"
// claims from public HTMLs. Site owner does not currently hold either
// credential; mentioning them is false advertising.
//
// Usage: node scripts/scrub-license-claims.mjs
//
// Skips: proposals/, .netlify/, node_modules/, scripts/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Skip: build/vendor dirs, font docs (not Toro claims, just typeface licenses),
// crm-v2.html (DB field name `drivers_license_number` is legit),
// work-with-us.html (asks applicant for THEIR driver's license — legit).
const SKIP = new Set(['proposals', '.netlify', 'node_modules', 'scripts', '.git', 'assets']);
const SKIP_FILES = new Set(['crm-v2.html', 'work-with-us.html', 'crm.html']);

// Order matters: longer/more-specific replacements first so the shorter
// catch-all doesn't truncate a sentence mid-claim.
const REPLACEMENTS = [
  // === A. Strip license suffix from <meta>, OG, Twitter, JSON-LD descriptions ===
  // Most specific first
  [/\. Licensed and insured in Florida\./g, '.'],
  [/\. Con licencia y seguro en Florida\./g, '.'],
  [/ Licensed &amp; insured\./g, ''],
  [/ Licensed & insured\./g, ''],
  [/ Licensed and insured\./g, ''],
  [/ Con licencia y seguro\./g, ''],
  [/ con licencia y seguro\b/g, ''],
  [/, licensed and insured\b/g, ''],
  [/family-owned, Florida-licensed moving company/g, 'family-owned moving company'],
  // Composite phrases at start of leads/sentences
  [/Licensed, insured, family-owned moving company/g, 'Family-owned moving company'],
  // Spanish hero ledes: "Empresa familiar con licencia y seguro en Orlando..."
  [/Empresa familiar con licencia y seguro/g, 'Empresa familiar'],
  [/Empresa de mudanzas con licencia y seguro/g, 'Empresa de mudanzas familiar'],

  // === B. Hero lede / meta descriptions (English + Spanish + Portuguese) ===
  [/Licensed and insured moving company/g, 'Family-owned moving company'],
  [/Licensed &amp; insured moving company/g, 'Family-owned moving company'],
  [/Licensed & insured moving company/g, 'Family-owned moving company'],
  // Portuguese (mudanca.html / mudança)
  [/com licença e seguro/g, ''],
  [/Empresa familiar com licença e seguro/g, 'Empresa familiar'],
  [/empresa familiar de mudança com licença e seguro/g, 'empresa familiar de mudança'],

  // === C. Trust list <li> items: replace inner <span> content ===
  // Variations of the phrase wrapped in <b> inside <span>
  [/<span><b>Licensed &amp; insured<\/b> in Florida<\/span>/g, '<span><b>Background-checked crew</b></span>'],
  [/<span><b>Licensed &amp; insured<\/b><\/span>/g, '<span><b>Background-checked crew</b></span>'],
  [/<span><b>Licensed & insured<\/b> in Florida<\/span>/g, '<span><b>Background-checked crew</b></span>'],
  [/<span><b>Licensed & insured<\/b><\/span>/g, '<span><b>Background-checked crew</b></span>'],
  // Spanish trust list: <span><b>Licencia y seguro</b></span>
  [/<span><b>Licencia y seguro<\/b><\/span>/g, '<span><b>Equipo verificado</b></span>'],
  // Portuguese trust list
  [/<span><b>Licença e seguro<\/b><\/span>/g, '<span><b>Equipe verificada</b></span>'],
  // Portuguese footer: "Toro Movers · Com licença e seguro na Flórida · Atende..."
  [/Toro Movers · Com licença e seguro na Flórida · /g, 'Toro Movers · '],
  // lp.html style: <span class="b">...Licensed & Insured</span>
  [/(<span class="b">[\s\S]*?)Licensed & Insured(<\/span>)/g, '$1Background-checked crew$2'],
  [/(<span class="b">[\s\S]*?)Con licencia y seguro(<\/span>)/g, '$1Equipo verificado$2'],

  // === D. lp.html crew-fact spans: delete the entire span ===
  [/<span class="crew-fact"><svg[^>]*>[\s\S]*?<\/svg>Licensed in FL<\/span>\s*/g, ''],
  [/<span class="crew-fact"><svg[^>]*>[\s\S]*?<\/svg>Fully Insured<\/span>\s*/g, ''],
  [/<span class="crew-fact"><svg[^>]*>[\s\S]*?<\/svg>Licencia en FL<\/span>\s*/g, ''],
  [/<span class="crew-fact"><svg[^>]*>[\s\S]*?<\/svg>Con seguro<\/span>\s*/g, ''],

  // === E. Body sentences ===
  [/Licensed and insured\. No subcontractors/g, 'No subcontractors'],
  [/Con licencia\. Con seguro\. Sin subcontratistas/g, 'Sin subcontratistas'],
  [/We're fully insured\. /g, ''],
  [/Fully insured\. We wrap/g, 'We wrap'],
  [/We're insured for it, and our crews/g, 'Our crews'],
  [/We're insured for it\. Crews are/g, 'Crews are'],
  // About signature:  "— The Toro family · Orlando, FL · Licensed & insured"
  [/( · Orlando, FL) · Licensed & insured/g, '$1'],
  [/( · Orlando, FL) · Licensed &amp; insured/g, '$1'],

  // === F. FAQ Q&A: remove the entire <details> block ===
  // Single-line variant
  [/<details class="faq__item"><summary>Are you licensed and insured\?<\/summary><p class="answer">[^<]*<\/p><\/details>/g, ''],
  // Multi-line variant (index.html splits across lines)
  [/<details class="faq__item">\s*<summary>Are you licensed and insured\?<\/summary>\s*<p class="answer">[^<]*<\/p>\s*<\/details>/g, ''],
  // Spanish/alternate copies
  [/<details class="faq__item"><summary>¿Tienen licencia y seguro\?<\/summary><p class="answer">[^<]*<\/p><\/details>/g, ''],
  [/<details class="faq__item">\s*<summary>¿Tienen licencia y seguro\?<\/summary>\s*<p class="answer">[^<]*<\/p>\s*<\/details>/g, ''],

  // === G. Hours / contact line in footer-style blocks ===
  [/<br>Licensed &amp; insured in Florida\./g, ''],
  [/<br>Con licencia y seguro en Florida\./g, ''],
  [/Licensed &amp; insured in Florida<br>\s*/g, ''],
  [/Licensed &amp; Insured · Orlando &amp; Central Florida<br>\s*/g, 'Orlando &amp; Central Florida<br>\n'],

  // === H. Footer copyright lines ===
  [/(© \d{4} Toro Movers · Family-owned) · Licensed &amp; insured in Florida/g, '$1 in Central Florida'],
  [/(© \d{4} Toro Movers · Family-owned) · Licensed & insured in Florida/g, '$1 in Central Florida'],
  [/Toro Movers · Licensed & Insured · Central Florida/g, 'Toro Movers · Family-owned · Central Florida'],
  [/Toro Movers · Licensed & insured · Central Florida/g, 'Toro Movers · Family-owned · Central Florida'],
  [/Toro Movers · Con licencia y seguro · Florida Central/g, 'Toro Movers · Familiar · Florida Central'],
  [/Toro Movers · Licensed &amp; insured in Florida · Serving Orlando &amp; Central Florida/g,
   'Toro Movers · Serving Orlando &amp; Central Florida'],

  // === I. index.html "Licensed"/"Insured" two-up badge LIs ===
  [/<li><strong>Licensed<\/strong><span>Florida moving company<\/span><\/li>\s*/g, ''],
  [/<li><strong>Insured<\/strong><span>Cargo &amp; general liability<\/span><\/li>\s*/g, ''],

  // === J. Inline-form footer lines with " · Licensed & insured" suffix ===
  // The JS source uses LITERAL \xb7 escape sequences (not actual middot
  // bytes), so match the four-character string "\xb7" verbatim.
  [/(\$75\/mover\/hour \\xb7 2-hour minimum) \\xb7 Licensed & insured/g, '$1'],
  [/(\$75\/mover\/hour \\xb7 2-hour minimum) \\xb7 Licensed &amp; insured/g, '$1'],
  [/(\$75\/mudancero\/hora \\xb7 2 horas mínimo) \\xb7 Con licencia y seguro/g, '$1'],
  // Also handle literal-middot variants in case any pages use them
  [/(\$75\/mover\/hour · 2-hour minimum) · Licensed & insured/g, '$1'],
  [/(\$75\/mover\/hour · 2-hour minimum) · Licensed &amp; insured/g, '$1'],

  // === K. Damage Q&A polish (English) ===
  [/Yes — fully licensed and insured in Florida\.[^<]*/g, ''],
  [/We're fully insured\. Furniture is wrapped before handling\./g, 'Furniture is wrapped before handling.'],
  [/We're insured for it, and our crews are trained to wrap furniture before moving it\. /g, 'Our crews are trained to wrap furniture before moving it. '],

  // === L. Keywords meta (rare, only on lp pages) ===
  [/licensed insured movers florida/g, 'family owned movers florida'],
  [/mudanzas con seguro florida/g, 'mudanzas familiares florida'],

  // === M. Catch-all stragglers (do these LAST) ===
  [/Licensed &amp; insured in Florida\b/g, 'Family-owned in Central Florida'],
  [/Licensed & insured in Florida\b/g, 'Family-owned in Central Florida'],
  [/Con licencia y seguro en Florida\b/g, 'Empresa familiar en Florida Central'],
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      // Allow files starting with . but not dirs (e.g. .git)
      if (entry.isDirectory() && SKIP.has(entry.name)) continue;
    }
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      if (SKIP_FILES.has(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = walk(ROOT);
let totalReplacements = 0;
const perFile = [];

for (const f of files) {
  const orig = fs.readFileSync(f, 'utf8');
  let next = orig;
  let fileReps = 0;
  for (const [pattern, replacement] of REPLACEMENTS) {
    const before = next;
    next = next.replace(pattern, replacement);
    if (before !== next) {
      const matches = before.match(pattern);
      fileReps += matches ? matches.length : 1;
    }
  }
  if (next !== orig) {
    fs.writeFileSync(f, next);
    perFile.push({ file: path.relative(ROOT, f), reps: fileReps });
    totalReplacements += fileReps;
  }
}

console.log(`Scrubbed ${totalReplacements} occurrences across ${perFile.length} files:`);
for (const { file, reps } of perFile.sort((a, b) => b.reps - a.reps)) {
  console.log(`  ${reps.toString().padStart(3)}  ${file}`);
}

// Final audit — only flag REAL claims (not "Certificate of Insurance" for
// buildings, not "estoy seguro" Spanish "I'm sure").
console.log('\nFinal audit (any remaining hits indicate patterns the script missed):');
let leftover = 0;
const auditPattern = /licens|insur|IM3322|licencia|\bseguros?\b/gi;
const LEGITIMATE = [
  /Certificate of Insurance/i,
  /\bestoy seguro\b/i,
  /no estoy seguro/i,
  /drivers?_?license/i,
  /'s license/i,                   // "Driver's license"
  /License number/i,
];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const all = [...text.matchAll(auditPattern)];
  const real = all.filter((m) => {
    const start = Math.max(0, m.index - 40);
    const end = Math.min(text.length, m.index + m[0].length + 40);
    const ctx = text.slice(start, end);
    return !LEGITIMATE.some((p) => p.test(ctx));
  });
  if (real.length) {
    const samples = real.slice(0, 3).map((m) => {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + m[0].length + 20);
      return text.slice(start, end).replace(/\s+/g, ' ');
    });
    console.log(`  ${path.relative(ROOT, f)}: ${real.length} hit(s)`);
    samples.forEach((s) => console.log(`      … ${s} …`));
    leftover += real.length;
  }
}
console.log(`Leftover real claims: ${leftover}`);
