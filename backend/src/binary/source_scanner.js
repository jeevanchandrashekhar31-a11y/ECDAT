const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');

// D: Load Rule-driven signatures
let CRYPTO_RULES = [];
try {
  const rulesPath = path.resolve(__dirname, '../../../rules/crypto_signatures.json');
  const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  CRYPTO_RULES = rulesData.algorithms || [];
} catch (e) {
  console.error("Failed to load crypto_signatures.json:", e.message);
}

const SKIP_DIRS = new Set([".git", ".svn", "node_modules", ".idea", ".vscode", "__pycache__"]);

// C: Path Context classification
function classifyPath(filePath) {
  const lowerPath = filePath.toLowerCase();
  
  if (lowerPath.includes('/test/') || lowerPath.includes('/tests/') || lowerPath.includes('/spec/') || 
      lowerPath.includes('test_') || lowerPath.endsWith('_test.go') || lowerPath.endsWith('_test.js')) {
    return { environment: 'test', evidence_role: 'usage' };
  }
  
  if (lowerPath.includes('/vendor/') || lowerPath.includes('/third_party/') || lowerPath.includes('/node_modules/')) {
    return { environment: 'vendored', evidence_role: 'implementation' };
  }
  
  if (lowerPath.includes('/demo/') || lowerPath.includes('/examples/') || lowerPath.includes('/samples/')) {
    return { environment: 'demo', evidence_role: 'usage' };
  }
  
  if (lowerPath.includes('/tools/') || lowerPath.includes('/scripts/') || lowerPath.includes('/build/')) {
    return { environment: 'tooling', evidence_role: 'usage' };
  }
  
  if (lowerPath.includes('/doc/') || lowerPath.includes('/docs/')) {
    return { environment: 'docs', evidence_role: 'reference' };
  }

  const cryptoImplPattern = /\b(?:crypto|openssl|boringssl|libsodium|bouncycastle|ring)\/.*\.(c|h|cpp|rs|go)$/;
  if (cryptoImplPattern.test(lowerPath)) {
    return { environment: 'production', evidence_role: 'implementation' };
  }

  return { environment: 'production', evidence_role: 'usage' };
}

// A: Lexical Awareness
function stripCommentsAndStrings(content, ext) {
  let result = content;
  if (['.c', '.cpp', '.h', '.hpp', '.java', '.js', '.ts', '.cs', '.go', '.rs'].includes(ext)) {
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length));
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, m => ' '.repeat(m.length));
    result = result.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    result = result.replace(/\/\/.*/g, m => ' '.repeat(m.length));
  } else if (['.py'].includes(ext)) {
    result = result.replace(/(["'])\1\1[\s\S]*?\1\1\1/g, m => m.replace(/[^\n]/g, ' '));
    result = result.replace(/#.*/g, m => ' '.repeat(m.length));
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, m => ' '.repeat(m.length));
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, m => ' '.repeat(m.length));
  }
  return result;
}

const EXT_TO_LANG = {
  '.c': 'c', '.h': 'c', '.cpp': 'c', '.hpp': 'c',
  '.java': 'java', '.py': 'python', '.js': 'javascript', '.ts': 'javascript',
  '.go': 'go', '.cs': 'csharp', '.rs': 'rust'
};

function buildRegexMap() {
  const map = {};
  for (const algo of CRYPTO_RULES) {
    if (!algo.patterns) continue;
    for (const [lang, patterns] of Object.entries(algo.patterns)) {
      if (!map[lang]) map[lang] = [];
      for (const p of patterns) {
        map[lang].push({
          algoId: algo.id,
          name: algo.name,
          risk: algo.risk,
          regex: new RegExp(p.re, p.re.includes('\\b') ? 'g' : 'g'),
          extract: p.extract
        });
      }
    }
  }
  return map;
}

const REGEX_MAP = buildRegexMap();

async function scanSourceDirectory(dirPath, options = {}) {
  const maxFiles = options.maxFiles || 50000;
  const components = [];
  const componentMap = new Map();
  const languages = new Set();
  
  let totalFindingsRaw = 0;
  let totalFiles = 0;
  let isTruncated = false;

  function* walkDir(dir, maxDepth = 12, depth = 0) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const res = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkDir(res, maxDepth, depth + 1);
      } else {
        yield res;
      }
    }
  }

  for (const filePath of walkDir(dirPath)) {
    if (totalFiles >= maxFiles) {
      isTruncated = true;
      break;
    }

    const ext = path.extname(filePath).toLowerCase();
    const langStr = EXT_TO_LANG[ext];
    if (!langStr) continue;

    const filePatterns = REGEX_MAP[langStr];
    if (!filePatterns || filePatterns.length === 0) continue;

    totalFiles++;

    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const lines = rawContent.split('\n');
      const strippedContent = stripCommentsAndStrings(rawContent, ext);
      const pathCtx = classifyPath(filePath);

      const findings = [];
      for (const pattern of filePatterns) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match;
        while ((match = regex.exec(strippedContent)) !== null) {
          try {
            let info = { algorithm: pattern.extract.algorithm, lib: pattern.extract.lib, isPQC: pattern.extract.isPQC };
            if (pattern.extract.keySize && match[pattern.extract.keySize.replace('$', '')]) info.keySize = match[pattern.extract.keySize.replace('$', '')];
            
            let lineNumber = 1;
            for (let i = 0; i < match.index; i++) {
              if (strippedContent[i] === '\n') lineNumber++;
            }
            const lineContent = lines[lineNumber - 1]?.trim() || '';
            const algorithm = info.algorithm || pattern.name;

            findings.push({
              algorithm,
              rawMatch: (' ' + match[0].slice(0, 120)).slice(1),
              library: info.lib || 'unknown',
              keySize: info.keySize || null,
              isPQC: pattern.risk?.quantum_break === false || info.isPQC,
              filePath,
              lineNumber,
              evidence: (' ' + lineContent.slice(0, 200)).slice(1),
              lang: langStr,
              evidence_role: pathCtx.evidence_role,
              is_test_environment: pathCtx.environment === 'test',
              risk: pattern.risk
            });
          } catch {}
        }
      }

      if (findings.length > 0) languages.add(langStr);
      totalFindingsRaw += findings.length;

      for (const f of findings) {
        const key = `${f.algorithm}|${f.library}|${f.keySize || ''}`;
        if (!componentMap.has(key)) {
          const bomRef = `${key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${components.length}`;
          const component = {
            type: 'cryptographic-asset',
            name: f.algorithm,
            bomRef,
            version: f.keySize ? `${f.keySize}-bit` : undefined,
            properties: [
              { name: 'ecdat:library', value: f.library },
              { name: 'ecdat:language', value: f.lang },
              { name: 'ecdat:sourceFile', value: path.relative(dirPath, f.filePath) },
              { name: 'ecdat:lineNumber', value: String(f.lineNumber) },
              { name: 'ecdat:evidence', value: f.evidence },
              { name: 'ecdat:evidence_role', value: f.evidence_role },
              { name: 'ecdat:is_test_environment', value: String(f.is_test_environment) }
            ].filter(Boolean),
            cryptoProperties: {
              assetType: 'algorithm',
              algorithmProperties: {
                primitive: f.isPQC ? 'pqc' : 'unknown',
                executionEnvironment: 'software-plain-ram',
                classical_break: f.risk?.classical_break || false,
                quantum_break: f.risk?.quantum_break || false
              }
            }
          };
          components.push(component);
          componentMap.set(key, component);
        } else {
          const component = componentMap.get(key);
          if (component.properties.length < 50) {
            component.properties.push({ name: 'ecdat:sourceFile', value: path.relative(dirPath, f.filePath) });
            component.properties.push({ name: 'ecdat:lineNumber', value: String(f.lineNumber) });
            component.properties.push({ name: 'ecdat:evidence', value: f.evidence });
          }
        }
      }
    } catch {}
  }

  return {
    cbom: buildCbom(components, options.projectName || path.basename(dirPath), totalFiles, totalFindingsRaw, Array.from(languages), isTruncated),
    stats: {
      totalFiles,
      totalFindingsRaw,
      totalComponents: components.length,
      languages: Array.from(languages),
      isTruncated
    }
  };
}

async function scanSourceZip(zipFilePath, options = {}) {
  const maxFiles = options.maxFiles || 150000;
  const components = [];
  const componentMap = new Map();
  const languages = new Set();
  let totalFindingsRaw = 0;
  let totalFiles = 0;
  let isTruncated = false;

  return new Promise((resolve, reject) => {
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      let isZipEnded = false;
      let pendingReads = 0;
      let isReadingEntry = false;
      const MAX_CONCURRENT = 100;

      function checkDone() {
        if (isZipEnded && pendingReads === 0) {
          resolve({
            cbom: buildCbom(components, options.projectName || path.basename(zipFilePath), totalFiles, totalFindingsRaw, Array.from(languages), isTruncated),
            stats: { totalFiles, totalFindingsRaw, totalComponents: components.length, languages: Array.from(languages), isTruncated }
          });
        }
      }

      function nextEntry() {
        if (!isZipEnded && !isReadingEntry && pendingReads < MAX_CONCURRENT) {
          isReadingEntry = true;
          zipfile.readEntry();
        }
      }

      nextEntry();

      zipfile.on('entry', (entry) => {
        isReadingEntry = false;

        if (/[\\/]$/.test(entry.fileName)) {
          return nextEntry();
        }

        const parts = entry.fileName.split('/');
        if (parts.some(p => SKIP_DIRS.has(p))) {
          return nextEntry();
        }

        const ext = path.extname(entry.fileName).toLowerCase();
        const langStr = EXT_TO_LANG[ext];
        if (!langStr) {
          return nextEntry();
        }
        
        const filePatterns = REGEX_MAP[langStr];
        if (!filePatterns || filePatterns.length === 0) {
          return nextEntry();
        }

        if (totalFiles >= maxFiles) {
          isZipEnded = true;
          isTruncated = true;
          zipfile.close();
          checkDone();
          return;
        }
        totalFiles++;

        pendingReads++;
        nextEntry();

        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) {
            pendingReads--;
            nextEntry();
            checkDone();
            return;
          }
          let rawContent = '';
          readStream.on('data', chunk => {
            rawContent += chunk.toString('utf8');
          });
          readStream.on('error', () => {
            pendingReads--;
            nextEntry();
            checkDone();
          });
          readStream.on('end', () => {
            pendingReads--;
            const findings = [];
            const lines = rawContent.split('\n');
            const strippedContent = stripCommentsAndStrings(rawContent, ext);
            const pathCtx = classifyPath(entry.fileName);

            for (const pattern of filePatterns) {
              const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
              let match;
              while ((match = regex.exec(strippedContent)) !== null) {
                try {
                  let info = { algorithm: pattern.extract.algorithm, lib: pattern.extract.lib, isPQC: pattern.extract.isPQC };
                  if (pattern.extract.keySize && match[pattern.extract.keySize.replace('$', '')]) info.keySize = match[pattern.extract.keySize.replace('$', '')];
                  
                  let lineNumber = 1;
                  for (let i = 0; i < match.index; i++) {
                    if (strippedContent[i] === '\n') lineNumber++;
                  }
                  const lineContent = lines[lineNumber - 1]?.trim() || '';
                  const algorithm = info.algorithm || pattern.name;

                  findings.push({
                    algorithm,
                    rawMatch: (' ' + match[0].slice(0, 120)).slice(1),
                    library: info.lib || 'unknown',
                    keySize: info.keySize || null,
                    isPQC: pattern.risk?.quantum_break === false || info.isPQC,
                    filePath: entry.fileName,
                    lineNumber,
                    evidence: (' ' + lineContent.slice(0, 200)).slice(1),
                    lang: langStr,
                    evidence_role: pathCtx.evidence_role,
                    is_test_environment: pathCtx.environment === 'test',
                    risk: pattern.risk
                  });
                } catch { }
              }
            }

            if (findings.length > 0) languages.add(langStr);
            totalFindingsRaw += findings.length;

            for (const f of findings) {
              const key = `${f.algorithm}|${f.library}|${f.keySize || ''}`;
              if (!componentMap.has(key)) {
                const bomRef = `${key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${components.length}`;
                const component = {
                  type: 'cryptographic-asset',
                  name: f.algorithm,
                  bomRef,
                  version: f.keySize ? `${f.keySize}-bit` : undefined,
                  properties: [
                    { name: 'ecdat:library', value: f.library },
                    { name: 'ecdat:language', value: f.lang },
                    { name: 'ecdat:sourceFile', value: f.filePath },
                    { name: 'ecdat:lineNumber', value: String(f.lineNumber) },
                    { name: 'ecdat:evidence', value: f.evidence },
                    { name: 'ecdat:evidence_role', value: f.evidence_role },
                    { name: 'ecdat:is_test_environment', value: String(f.is_test_environment) }
                  ].filter(Boolean),
                  cryptoProperties: {
                    assetType: 'algorithm',
                    algorithmProperties: {
                      primitive: f.isPQC ? 'pqc' : 'unknown',
                      executionEnvironment: 'software-plain-ram',
                      classical_break: f.risk?.classical_break || false,
                      quantum_break: f.risk?.quantum_break || false
                    }
                  }
                };
                components.push(component);
                componentMap.set(key, component);
              } else {
                const component = componentMap.get(key);
                if (component.properties.length < 50) {
                  component.properties.push({ name: 'ecdat:sourceFile', value: f.filePath });
                  component.properties.push({ name: 'ecdat:lineNumber', value: String(f.lineNumber) });
                  component.properties.push({ name: 'ecdat:evidence', value: f.evidence });
                }
              }
            }
            nextEntry();
            checkDone();
          });
        });
      });

      zipfile.on('end', () => {
        isZipEnded = true;
        checkDone();
      });
      zipfile.on('error', (err) => reject(err));
    });
  });
}

function buildCbom(components, projectName, totalFiles, totalFindingsRaw, languages, isTruncated) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "ECDAT", name: "Source Code Scanner", version: "3.0.0" }],
      component: {
        type: "application",
        name: projectName,
        description: `Source code scan of ${projectName}`,
      },
    },
    components,
    _scanMeta: {
      scanId: `scan_src_${crypto.randomUUID()}`,
      totalFilesScanned: totalFiles,
      trueTotalOccurrences: totalFindingsRaw,
      scanIncomplete: isTruncated,
      languages
    },
  };
}

async function extractFromFile() {
  throw new Error('Not implemented for this version');
}

module.exports = { scanSourceDirectory, scanSourceZip, buildCbom, extractFromFile, SKIP_DIRS };
