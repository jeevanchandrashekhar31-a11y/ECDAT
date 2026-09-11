const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ingestCbom, getLatestScan, getAllScans, getScanById } = require('../services/cbom_ingestion');
const config = require('../config');

const router = express.Router();

// Root directory of ECDAT project
const REPO_ROOT = path.resolve(__dirname, '../../../');
const ARTIFACTS_DIR = path.resolve(REPO_ROOT, 'artifacts');

// Cache for the latest merged CBOM
let cachedMergedCbom = null;

/**
 * Helper to safely load JSON file
 */
function loadJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.warn(`Could not load JSON from ${filePath}: ${err.message}`);
  }
  return null;
}

/**
 * Runs a python command asynchronously with timeout
 */
function runPythonCommand(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pythonBin, args, { cwd: REPO_ROOT, shell: false });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Runs git clone asynchronously with timeout
 */
function runGitClone(repoUrl, targetDir, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let trimmed = String(repoUrl || '').trim();
    if (!trimmed) {
      return reject(new Error("Git repository URL cannot be empty."));
    }

    // Auto-normalize URLs missing protocol scheme (e.g. github.com/user/repo)
    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://') && !trimmed.startsWith('git@') && !trimmed.startsWith('git://')) {
      if (trimmed.includes('/') && !trimmed.startsWith('/')) {
        trimmed = `https://${trimmed}`;
      } else {
        return reject(new Error(`Invalid Git repository URL: '${repoUrl}'. URL must start with https://, http://, or git@`));
      }
    }

    // Strip web UI /tree/<branch> or /blob/<branch> patterns from browser copy-paste
    let branch = null;
    const treeMatch = trimmed.match(/^(https?:\/\/[^/]+\/[^/]+(?:\/[^/]+)?)\/(?:tree|blob)\/([^/]+)/);
    if (treeMatch) {
      trimmed = treeMatch[1];
      branch = treeMatch[2];
    }
    // Remove trailing slashes
    trimmed = trimmed.replace(/\/+$/, '');

    // Ensure targetDir is clean and exists
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });
    } catch {}

    const cloneArgs = ['clone', '--depth', '1'];
    if (branch) {
      cloneArgs.push('-b', branch);
    }
    cloneArgs.push(trimmed, targetDir);

    const child = spawn('git', cloneArgs, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Git clone timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Git clone failed (exit code ${code}): ${stderr || stdout}`));
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Extracts a zip archive to a target directory using Python's built-in zipfile module
 */
async function extractZipArchive(zipFilePath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  await runPythonCommand(['-m', 'zipfile', '-e', zipFilePath, targetDir], 45000);
}

/**
 * Safely parses any URL or host string into a clean hostname and port
 */
function parseNetworkTarget(inputTarget, defaultPort = 443) {
  if (!inputTarget || !String(inputTarget).trim()) {
    return null;
  }
  let str = String(inputTarget).trim();
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      const parsed = new URL(str);
      const host = parsed.hostname;
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'http:' ? 80 : 443);
      return { host, port };
    }
  } catch {}

  str = str.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  let port = defaultPort;
  if (str.includes(':')) {
    const parts = str.split(':');
    str = parts[0];
    port = parseInt(parts[1], 10) || defaultPort;
  }
  if (!str) return null;
  return { host: str, port };
}

const multer = require('multer');

// Configure bounded upload storage supporting archives and multiple source files up to 50MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 250 }
});

// --------------------------------------------------------------------------
// 1. POST /scan/static
// --------------------------------------------------------------------------
router.post('/scan/static', upload.any(), async (req, res, next) => {
  const uploadSessionId = `scan_${Date.now()}`;
  const uploadDir = path.resolve(ARTIFACTS_DIR, 'uploads', uploadSessionId);
  let targetDir = null;
  let scanLabel = req.body?.scan_label;

  try {
    // Detect Git repository URL across all possible input properties
    const candidateGitUrl = [
      req.body?.github_url,
      req.body?.git_url,
      req.body?.repo_url,
      req.body?.repository,
      req.body?.target,
      req.body?.target_dir,
      req.body?.url
    ].find(val => {
      if (typeof val !== 'string') return false;
      const s = val.trim();
      return (
        s.startsWith('https://') ||
        s.startsWith('http://') ||
        s.startsWith('git@') ||
        s.includes('github.com') ||
        s.includes('gitlab.com') ||
        s.includes('bitbucket.org') ||
        s.endsWith('.git')
      );
    });

    const isGitMode = Boolean(candidateGitUrl || (req.body?.github_url && String(req.body.github_url).trim()));
    const gitRepoUrl = candidateGitUrl ? candidateGitUrl.trim() : (req.body?.github_url ? String(req.body.github_url).trim() : null);

    // A. Git Repository Clone Mode
    if (isGitMode && gitRepoUrl) {
      targetDir = uploadDir;
      const cleanUrl = gitRepoUrl.replace(/\/+$/, '');
      const repoName = path.basename(cleanUrl.replace(/\.git$/, '')) || 'repository';
      scanLabel = scanLabel || `Git Repo: ${repoName}`;
      try {
        await runGitClone(gitRepoUrl, targetDir, 60000);
      } catch (cloneErr) {
        return res.status(400).json({
          success: false,
          error: `Git clone failed: ${cloneErr.message}`
        });
      }
    }
    // B. Direct File or ZIP Upload Mode
    else if (req.files && req.files.length > 0) {
      fs.mkdirSync(uploadDir, { recursive: true });
      const zipFile = req.files.find(f =>
        f.originalname?.toLowerCase().endsWith('.zip') ||
        f.mimetype === 'application/zip' ||
        f.mimetype === 'application/x-zip-compressed'
      );

      if (zipFile) {
        const tempZipPath = path.resolve(ARTIFACTS_DIR, 'uploads', `${uploadSessionId}.zip`);
        fs.writeFileSync(tempZipPath, zipFile.buffer);
        try {
          await extractZipArchive(tempZipPath, uploadDir);
        } finally {
          try { fs.unlinkSync(tempZipPath); } catch {}
        }
        scanLabel = scanLabel || `Uploaded ZIP: ${zipFile.originalname}`;
      } else {
        // Multi-file upload: write files safely
        for (const file of req.files) {
          const safeName = path.basename(file.originalname);
          fs.writeFileSync(path.join(uploadDir, safeName), file.buffer);
        }
        scanLabel = scanLabel || `Uploaded Project (${req.files.length} files)`;
      }
      targetDir = uploadDir;
    }
    // C. Explicit target_dir mode
    else {
      let explicitPath = req.body?.target_dir || req.body?.target;
      if (!explicitPath || !explicitPath.trim()) {
        return res.status(400).json({
          success: false,
          error: "Please provide a Git repository URL, upload project files/ZIP, or specify a valid target directory."
        });
      }
      explicitPath = explicitPath.trim().replace(/^['"]|['"]$/g, '');
      if (!path.isAbsolute(explicitPath)) {
        targetDir = path.resolve(REPO_ROOT, explicitPath);
      } else {
        targetDir = explicitPath;
      }
      scanLabel = scanLabel || `Static Scan: ${path.basename(targetDir)}`;
    }

    // Validate directory existence
    if (!fs.existsSync(targetDir)) {
      return res.status(400).json({
        success: false,
        error: `Target directory does not exist on disk: '${targetDir}'. Please upload a ZIP archive, enter a Git URL, or provide a valid directory.`
      });
    }

    const tempOut = path.resolve(REPO_ROOT, `artifacts/temp_static_${Date.now()}.json`);
    if (!fs.existsSync(path.dirname(tempOut))) {
      fs.mkdirSync(path.dirname(tempOut), { recursive: true });
    }

    const supportedExts = '.c,.h,.cpp,.hpp,.cc,.go,.js,.mjs,.cjs,.ts,.tsx,.py,.java';
    try {
      await runPythonCommand(
        ['-m', 'scanners.static.main', targetDir, '-o', tempOut, '--include-ext', supportedExts, '--fail-on', 'none'],
        180000
      );
    } catch (scannerErr) {
      return res.status(400).json({
        success: false,
        error: `Static scanner failed: ${scannerErr.message}`
      });
    }

    const cbomData = loadJsonSafe(tempOut);
    if (!cbomData) {
      return res.status(500).json({
        success: false,
        error: 'Static scanner completed but no output CBOM was generated.'
      });
    }

    // Clean up temporary output file
    try { fs.unlinkSync(tempOut); } catch {}

    // Ingest into risk engine
    const scanRecord = await ingestCbom(cbomData, {
      scannerType: 'static',
      scanName: scanLabel,
      policyProfile: req.body?.policy_profile || 'regulated_bfsi',
      scenario: req.body?.scenario || 'baseline'
    });

    res.status(200).json({
      success: true,
      message: 'Static cryptographic scan completed and evaluated',
      scan_source: 'live_scanner',
      scan_id: scanRecord.id,
      metrics: scanRecord.metrics,
      cbom: scanRecord.annotated_bom || cbomData,
      top_risky_assets: scanRecord.top_risky_assets || [],
      recommendations: scanRecord.recommendations || []
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 2. POST /scan/network
// --------------------------------------------------------------------------
router.post('/scan/network', async (req, res, next) => {
  try {
    const rawTarget = req.body?.url || req.body?.target || req.body?.host;
    if (!rawTarget || !String(rawTarget).trim()) {
      return res.status(400).json({
        success: false,
        error: "Please provide a target hostname or IP address to scan."
      });
    }
    const rawPort = req.body?.port || 443;
    const parsed = parseNetworkTarget(rawTarget, rawPort);
    if (!parsed || !parsed.host) {
      return res.status(400).json({
        success: false,
        error: `Invalid network target: '${rawTarget}'. Please provide a valid hostname or IP address.`
      });
    }
    const { host, port } = parsed;

    const tempOut = path.resolve(REPO_ROOT, `artifacts/temp_network_${Date.now()}.json`);

    if (!fs.existsSync(path.dirname(tempOut))) {
      fs.mkdirSync(path.dirname(tempOut), { recursive: true });
    }

    try {
      await runPythonCommand(['-m', 'scanners.network.main', `${host}:${port}`, '-o', tempOut, '--timeout', '10'], 20000);
    } catch (scannerErr) {
      return res.status(400).json({
        success: false,
        error: `Network probe failed: ${scannerErr.message}. Ensure target host is reachable.`
      });
    }

    const cbomData = loadJsonSafe(tempOut);
    if (!cbomData) {
      return res.status(500).json({
        success: false,
        error: 'Network scanner completed but no output CBOM was generated.'
      });
    }

    // Clean up temporary file
    try { fs.unlinkSync(tempOut); } catch {}

    const scanRecord = await ingestCbom(cbomData, {
      scannerType: 'network',
      scanName: req.body?.scan_label || `Network Scan: ${host}:${port}`,
      policyProfile: req.body?.policy_profile || 'regulated_bfsi',
      scenario: req.body?.scenario || 'baseline'
    });

    res.status(200).json({
      success: true,
      message: 'Network cryptographic probe completed and evaluated',
      scan_source: 'live_scanner',
      scan_id: scanRecord.id,
      metrics: scanRecord.metrics,
      cbom: scanRecord.annotated_bom || cbomData,
      top_risky_assets: scanRecord.top_risky_assets || [],
      recommendations: scanRecord.recommendations || []
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 3. POST /scan/binary
// --------------------------------------------------------------------------
router.post('/scan/binary', upload.any(), async (req, res, next) => {
  const uploadSessionId = `scan_bin_${Date.now()}`;
  const uploadDir = path.resolve(ARTIFACTS_DIR, 'uploads', uploadSessionId);
  let target = null;
  let targetType = req.body?.target_type || 'directory';
  let scanLabel = req.body?.scan_label;

  try {
    // A. File / ZIP Archive Upload Mode
    if (req.files && req.files.length > 0) {
      fs.mkdirSync(uploadDir, { recursive: true });
      const zipFile = req.files.find(f =>
        f.originalname?.toLowerCase().endsWith('.zip') ||
        f.mimetype === 'application/zip' ||
        f.mimetype === 'application/x-zip-compressed'
      );

      if (zipFile) {
        const tempZipPath = path.resolve(ARTIFACTS_DIR, 'uploads', `${uploadSessionId}.zip`);
        fs.writeFileSync(tempZipPath, zipFile.buffer);
        try {
          await extractZipArchive(tempZipPath, uploadDir);
        } finally {
          try { fs.unlinkSync(tempZipPath); } catch {}
        }
        target = uploadDir;
        targetType = 'directory';
        scanLabel = scanLabel || `Binary Archive: ${zipFile.originalname}`;
      } else {
        // Save uploaded binary files
        for (const file of req.files) {
          const safeName = path.basename(file.originalname);
          fs.writeFileSync(path.join(uploadDir, safeName), file.buffer);
        }
        if (req.files.length === 1) {
          target = path.join(uploadDir, path.basename(req.files[0].originalname));
          targetType = 'file';
          scanLabel = scanLabel || `Binary: ${path.basename(req.files[0].originalname)}`;
        } else {
          target = uploadDir;
          targetType = 'directory';
          scanLabel = scanLabel || `Binary Package (${req.files.length} files)`;
        }
      }
    }
    // B. Container Image or Explicit Path Mode
    else {
      let explicitTarget = req.body?.image || req.body?.target;
      if (req.body?.image && String(req.body.image).trim()) {
        target = req.body.image.trim();
        targetType = 'image';
        scanLabel = scanLabel || `Container: ${target}`;
      } else if (explicitTarget && explicitTarget.trim()) {
        explicitTarget = explicitTarget.trim().replace(/^['"]|['"]$/g, '');
        if (explicitTarget.includes(':') && !explicitTarget.includes('\\') && !explicitTarget.includes('/')) {
          target = explicitTarget;
          targetType = 'image';
          scanLabel = scanLabel || `Container: ${target}`;
        } else {
          target = path.isAbsolute(explicitTarget) ? explicitTarget : path.resolve(REPO_ROOT, explicitTarget);
          scanLabel = scanLabel || `Binary Target: ${path.basename(target)}`;
        }
      } else {
        return res.status(400).json({
          success: false,
          error: "Please upload binary files/ZIP, specify a container image name, or provide a target path."
        });
      }
    }

    if (targetType !== 'image' && !fs.existsSync(target)) {
      return res.status(400).json({
        success: false,
        error: `Target path does not exist on disk: '${target}'. Please upload binary files or provide a container image name.`
      });
    }

    const tempOut = path.resolve(REPO_ROOT, `artifacts/temp_binary_${Date.now()}.json`);
    if (!fs.existsSync(path.dirname(tempOut))) {
      fs.mkdirSync(path.dirname(tempOut), { recursive: true });
    }

    try {
      await runPythonCommand(
        ['-m', 'scanners.binary_container.main', target, '--target-type', targetType, '-o', tempOut, '--timeout', '45'],
        60000
      );
    } catch (scannerErr) {
      return res.status(400).json({
        success: false,
        error: `Binary scanner failed: ${scannerErr.message}`
      });
    }

    const cbomData = loadJsonSafe(tempOut);
    if (!cbomData) {
      return res.status(500).json({
        success: false,
        error: 'Binary scanner completed but no output CBOM was generated.'
      });
    }

    // Clean up temporary output file
    try { fs.unlinkSync(tempOut); } catch {}

    const scanRecord = await ingestCbom(cbomData, {
      scannerType: 'binary_container',
      scanName: scanLabel || 'Binary/Container Library Inventory',
      policyProfile: req.body?.policy_profile || 'regulated_bfsi',
      scenario: req.body?.scenario || 'baseline'
    });

    res.status(200).json({
      success: true,
      message: 'Binary & container package analysis completed and evaluated',
      scan_source: 'live_scanner',
      scan_id: scanRecord.id,
      metrics: scanRecord.metrics,
      cbom: scanRecord.annotated_bom || cbomData,
      top_risky_assets: scanRecord.top_risky_assets || [],
      recommendations: scanRecord.recommendations || []
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 4. POST /cbom/merge
// --------------------------------------------------------------------------
router.post('/cbom/merge', async (req, res, next) => {
  try {
    let components = [];
    const seenRefs = new Set();

    // If explicit CBOMs provided in request body
    if (Array.isArray(req.body?.cboms) && req.body.cboms.length > 0) {
      for (const b of req.body.cboms) {
        if (Array.isArray(b.components)) {
          for (const c of b.components) {
            const ref = c['bom-ref'] || c.name;
            if (ref && !seenRefs.has(ref)) {
              seenRefs.add(ref);
              components.push(c);
            }
          }
        }
      }
    } else {
      // Collect from real scans run in this session
      const allScans = await getAllScans();
      if (allScans.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No scans have been run yet. Please run a static, network, or binary scan first.'
        });
      }

      for (const scan of allScans) {
        const rawBom = scan.annotated_bom || scan.raw_cbom;
        if (rawBom && Array.isArray(rawBom.components)) {
          for (const c of rawBom.components) {
            const ref = c['bom-ref'] || c.name;
            if (ref && !seenRefs.has(ref)) {
              seenRefs.add(ref);
              components.push(c);
            }
          }
        }
      }
    }

    if (components.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No cryptographic components found in recent scans to merge.'
      });
    }

    const mergedCbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: `urn:uuid:${Date.now()}-merged`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: {
          components: [
            { name: 'ecdat-scanner-network', version: '1.0.0' },
            { name: 'ecdat-scanner-static', version: '1.0.0' },
            { name: 'ecdat-scanner-binary', version: '1.0.0' }
          ]
        }
      },
      components
    };

    cachedMergedCbom = mergedCbom;

    // Ingest the merged CBOM
    const scanRecord = await ingestCbom(mergedCbom, {
      scannerType: 'combined',
      scanName: req.body?.scan_name || 'Merged Multi-Vector CBOM',
      policyProfile: req.body?.policy_profile || 'regulated_bfsi',
      scenario: req.body?.scenario || 'baseline'
    });

    res.status(200).json({
      success: true,
      message: 'Cryptographic Bills of Materials successfully merged',
      scan_id: scanRecord.id,
      total_merged_components: components.length,
      metrics: scanRecord.metrics,
      cbom: scanRecord.annotated_bom || mergedCbom,
      top_risky_assets: scanRecord.top_risky_assets || [],
      recommendations: scanRecord.recommendations || []
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 5. POST /cbom/quantum-risk
// --------------------------------------------------------------------------
router.post('/cbom/quantum-risk', async (req, res, next) => {
  try {
    let cbom = req.body?.cbom;
    if (!cbom) {
      const latest = getLatestScan();
      cbom = latest?.annotated_bom || latest?.raw_cbom || cachedMergedCbom;
    }

    if (!cbom) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'No scan has been run yet. Please run a scan or supply a CBOM payload first.'
      });
    }

    const scanRecord = await ingestCbom(cbom, {
      policyProfile: req.body?.policy_profile || 'regulated_bfsi',
      scenario: req.body?.scenario || 'baseline',
      scanName: req.body?.scan_name || 'Quantum Risk Analysis'
    });

    res.status(200).json({
      success: true,
      scan_id: scanRecord.id,
      policy_profile: scanRecord.policy_profile,
      scenario: scanRecord.scenario,
      mosca_status_counts: scanRecord.metrics.mosca_status_counts,
      metrics: scanRecord.metrics,
      top_risky_assets: scanRecord.top_risky_assets || [],
      findings: scanRecord.findings || [],
      explanation: `Quantum readiness posture evaluated under ${scanRecord.scenario} scenario.`
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 6. GET /cbom/merged
// --------------------------------------------------------------------------
router.get('/cbom/merged', async (req, res, next) => {
  try {
    const latest = getLatestScan();
    const cbom = cachedMergedCbom || latest?.annotated_bom || latest?.raw_cbom;
    if (!cbom) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'No scan has been run yet. Please run a scan first.'
      });
    }
    res.status(200).json(cbom);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 7. GET /cbom/risk
// --------------------------------------------------------------------------
router.get('/cbom/risk', async (req, res, next) => {
  try {
    const latest = getLatestScan();
    if (!latest) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'No scan has been run yet. Please run a scan first.'
      });
    }

    res.status(200).json({
      scan_id: latest.id,
      metrics: latest.metrics,
      top_risky_assets: latest.top_risky_assets || [],
      mosca_status_counts: latest.metrics.mosca_status_counts
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// 8. GET /cbom/pqc-report
// --------------------------------------------------------------------------
router.get('/cbom/pqc-report', async (req, res, next) => {
  try {
    const latest = getLatestScan();
    if (!latest) {
      return res.status(404).json({ error: 'NotFound', message: 'No PQC report available yet.' });
    }

    res.status(200).json({
      scan_id: latest.id,
      policy_profile: latest.policy_profile,
      scenario: latest.scenario,
      recommendations: latest.recommendations || [],
      metrics: latest.metrics,
      html_report_url: `/api/v1/reports/${latest.id}/html`
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
