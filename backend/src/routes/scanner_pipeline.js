const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ingestCbom, getLatestScan, getAllScans } = require('../services/cbom_ingestion');
const { defaultNetworkScanGuard } = require('../security/network_scan_guard');
const { validateSafeGitUrlAsync } = require('../security/ssrf_protection');
const {
  executeHardenedGitClone,
  validateSafeTargetDirectory,
  validateGitCloneUrl,
} = require('../security/git_clone_guard');
const {
  validateZipBufferSafety,
  ArchiveSecurityError,
} = require('../security/archive_guard');
const { RATE_LIMITS, concurrencyQuotaMiddleware } = require('../security/resource_governance');
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require('../audit');

function emitScanAudit({ action, status = AUDIT_STATUSES.SUCCESS, scanId, targetName, req, reason, details = {} }) {
  try {
    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.SCAN,
      action: action || AUDIT_ACTIONS.SCAN_STARTED,
      actor: {
        id: req.user?.sub || req.auth?.user?.sub || 'operator',
        username: req.user?.username || req.auth?.user?.name || 'operator',
        role: req.auth?.role || 'analyst',
        ipAddress: req.ip,
      },
      tenant: req.tenantContext?.tenantId || req.headers['x-tenant-id'] || 'default',
      target: { type: 'scan', id: scanId, name: targetName || scanId },
      requestId: req.id || req.headers['x-request-id'],
      result: status,
      reason: reason || null,
      sourceIp: req.ip,
      details,
    }).catch(() => {});
  } catch {}
}

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
 * Runs git clone asynchronously with timeout, quota controls, and strict argument security
 */
async function runGitClone(repoUrl, targetDir, timeoutMs = 60000) {
  return executeHardenedGitClone(repoUrl, targetDir, { timeoutMs });
}

/**
 * Safely extracts an archive to a target directory using ECDAT's hardened ArchiveSecurityGuard
 */
async function extractZipArchive(zipFilePath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  await runPythonCommand([
    '-m', 'scanners.common.archive_guard',
    'extract', zipFilePath, targetDir,
    '--max-size-mb', '100',
    '--max-entry-mb', '25',
    '--max-files', '10000',
  ], 180000);
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

// Configure bounded upload storage supporting archives and multiple source files up to 100MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 250 }
});

// --------------------------------------------------------------------------
// 1. POST /scan/static
// --------------------------------------------------------------------------
router.post('/scan/static', concurrencyQuotaMiddleware(), RATE_LIMITS.scanSubmission.middleware(), upload.any(), async (req, res, next) => {
  const uploadSessionId = `scan_${Date.now()}`;
  const uploadDir = path.resolve(ARTIFACTS_DIR, 'uploads', uploadSessionId);
  let targetDir = null;
  let scanLabel = req.body?.scan_label;
  let gitCloneHandle = null;

  emitScanAudit({
    action: AUDIT_ACTIONS.SCAN_STARTED,
    status: AUDIT_STATUSES.SUCCESS,
    scanId: uploadSessionId,
    targetName: scanLabel || 'static_scan',
    req,
    reason: 'Static scan initiated',
    details: { scanLabel },
  });

  try {
    // Detect Git repository URL across all possible input properties
    const explicitGitField = req.body?.git_url || req.body?.github_url || req.body?.repo_url || req.body?.repository;
    const candidateGitUrl = [
      explicitGitField,
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

    const isGitMode = Boolean(explicitGitField || candidateGitUrl);
    const gitRepoUrl = explicitGitField ? String(explicitGitField).trim() : (candidateGitUrl ? candidateGitUrl.trim() : null);

    // A. Git Repository Clone Mode
    if (isGitMode && gitRepoUrl) {
      const gitCheck = RATE_LIMITS.gitScan.consume(req);
      if (!gitCheck.allowed) {
        return res.status(429).json({
          error: 'TooManyRequests',
          code: 'RATE_LIMIT_EXCEEDED',
          operation: 'git_scan',
          message: RATE_LIMITS.gitScan.message,
          retryAfterSeconds: gitCheck.resetSeconds,
        });
      }

      targetDir = uploadDir;
      const cleanUrl = gitRepoUrl.replace(/\/+$/, '');
      const repoName = path.basename(cleanUrl.replace(/\.git$/, '')) || 'repository';
      scanLabel = scanLabel || `Git Repo: ${repoName}`;
      try {
        gitCloneHandle = await executeHardenedGitClone(gitRepoUrl, targetDir, {
          timeoutMs: 60000,
          branch: req.body?.branch,
        });
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
        const archiveCheck = RATE_LIMITS.archiveUpload.consume(req);
        if (!archiveCheck.allowed) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          return res.status(429).json({
            error: 'TooManyRequests',
            code: 'RATE_LIMIT_EXCEEDED',
            operation: 'archive_upload',
            message: RATE_LIMITS.archiveUpload.message,
            retryAfterSeconds: archiveCheck.resetSeconds,
          });
        }

        try {
          validateZipBufferSafety(zipFile.buffer);
        } catch (guardErr) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          return res.status(400).json({
            success: false,
            error: `Archive security rejection: ${guardErr.message}`
          });
        }

        const tempZipPath = path.resolve(ARTIFACTS_DIR, 'uploads', `${uploadSessionId}.zip`);
        fs.writeFileSync(tempZipPath, zipFile.buffer);
        try {
          await extractZipArchive(tempZipPath, uploadDir);
        } catch (extractErr) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          const rawErr = extractErr.message || String(extractErr);
          const cleanErr = rawErr.replace(/.*::error::/s, '').trim();
          return res.status(400).json({
            success: false,
            error: `Archive extraction failed: ${cleanErr || rawErr}`
          });
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
      try {
        targetDir = validateSafeTargetDirectory(explicitPath, REPO_ROOT);
      } catch (pathErr) {
        return res.status(400).json({
          success: false,
          error: `Invalid target directory: ${pathErr.message}`
        });
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
      scenario: req.body?.scenario || 'baseline',
      tenantContext: req.tenantContext
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
    emitScanAudit({
      action: AUDIT_ACTIONS.SCAN_FAILED,
      status: AUDIT_STATUSES.FAILURE,
      scanId: uploadSessionId,
      targetName: scanLabel || 'static_scan',
      req,
      reason: err.message || 'Static scan failed',
      details: { error: err.message },
    });
    next(err);
  } finally {
    // Guaranteed cleanup after scan completes or fails
    if (gitCloneHandle && typeof gitCloneHandle.cleanup === 'function') {
      gitCloneHandle.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// 2. POST /scan/network
// --------------------------------------------------------------------------
router.post('/scan/network', concurrencyQuotaMiddleware(), RATE_LIMITS.networkScan.middleware(), async (req, res, next) => {
  try {
    // 1. Enforce explicit authorization, tenant scoping, rate/concurrency limits, port bounding, SSRF & DNS resolution
    const guardResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(req);
    if (!guardResult.authorized) {
      return res.status(guardResult.status || 400).json({
        success: false,
        error: guardResult.error,
      });
    }

    const { hostname: host, port, authorizedBy, timeoutSeconds } = guardResult.targetInfo;
    const tempOut = path.resolve(REPO_ROOT, `artifacts/temp_network_${Date.now()}.json`);
    const networkScanId = `scan_net_${Date.now()}`;

    emitScanAudit({
      action: AUDIT_ACTIONS.SCAN_STARTED,
      status: AUDIT_STATUSES.SUCCESS,
      scanId: networkScanId,
      targetName: req.body?.scan_label || `Network Scan: ${host}:${port}`,
      req,
      reason: 'Network scan initiated',
      details: { host, port, authorizedBy },
    });

    if (!fs.existsSync(path.dirname(tempOut))) {
      fs.mkdirSync(path.dirname(tempOut), { recursive: true });
    }

    try {
      await runPythonCommand(
        [
          '-m', 'scanners.network.main',
          `${host}:${port}`,
          '-o', tempOut,
          '--timeout', String(timeoutSeconds),
          '--authorized-by', authorizedBy,
          '--allowed-hosts', host
        ],
        (timeoutSeconds + 5) * 1000
      );
    } catch (scannerErr) {
      return res.status(400).json({
        success: false,
        error: `Network probe failed: ${scannerErr.message}. Ensure target host is reachable.`
      });
    } finally {
      if (typeof guardResult.releaseConcurrency === 'function') {
        guardResult.releaseConcurrency();
      }
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
      scenario: req.body?.scenario || 'baseline',
      tenantContext: req.tenantContext
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
    emitScanAudit({
      action: AUDIT_ACTIONS.SCAN_FAILED,
      status: AUDIT_STATUSES.FAILURE,
      scanId: 'network_scan',
      targetName: req.body?.scan_label || 'network_scan',
      req,
      reason: err.message || 'Network scan failed',
      details: { error: err.message },
    });
    next(err);
  }
});

// --------------------------------------------------------------------------
// 3. POST /scan/binary
// --------------------------------------------------------------------------
router.post('/scan/binary', concurrencyQuotaMiddleware(), RATE_LIMITS.scanSubmission.middleware(), upload.any(), async (req, res, next) => {
  const uploadSessionId = `scan_bin_${Date.now()}`;
  const uploadDir = path.resolve(ARTIFACTS_DIR, 'uploads', uploadSessionId);
  let target = null;
  let targetType = req.body?.target_type || 'directory';
  let scanLabel = req.body?.scan_label;

  emitScanAudit({
    action: AUDIT_ACTIONS.SCAN_STARTED,
    status: AUDIT_STATUSES.SUCCESS,
    scanId: uploadSessionId,
    targetName: scanLabel || 'binary_scan',
    req,
    reason: 'Binary scan initiated',
    details: { scanLabel, targetType },
  });

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
        const archiveCheck = RATE_LIMITS.archiveUpload.consume(req);
        if (!archiveCheck.allowed) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          return res.status(429).json({
            error: 'TooManyRequests',
            code: 'RATE_LIMIT_EXCEEDED',
            operation: 'archive_upload',
            message: RATE_LIMITS.archiveUpload.message,
            retryAfterSeconds: archiveCheck.resetSeconds,
          });
        }

        try {
          validateZipBufferSafety(zipFile.buffer);
        } catch (guardErr) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          return res.status(400).json({
            success: false,
            error: `Archive security rejection: ${guardErr.message}`
          });
        }

        const tempZipPath = path.resolve(ARTIFACTS_DIR, 'uploads', `${uploadSessionId}.zip`);
        fs.writeFileSync(tempZipPath, zipFile.buffer);
        try {
          await extractZipArchive(tempZipPath, uploadDir);
        } catch (extractErr) {
          try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}
          const rawErr = extractErr.message || String(extractErr);
          const cleanErr = rawErr.replace(/.*::error::/s, '').trim();
          return res.status(400).json({
            success: false,
            error: `Archive extraction failed: ${cleanErr || rawErr}`
          });
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
      scenario: req.body?.scenario || 'baseline',
      tenantContext: req.tenantContext
    });

    res.status(200).json({
      success: true,
      message: 'Binary/Container cryptographic scan completed and evaluated',
      scan_source: 'live_scanner',
      scan_id: scanRecord.id,
      metrics: scanRecord.metrics,
      cbom: scanRecord.annotated_bom || cbomData,
      top_risky_assets: scanRecord.top_risky_assets || [],
      recommendations: scanRecord.recommendations || []
    });
  } catch (err) {
    emitScanAudit({
      action: AUDIT_ACTIONS.SCAN_FAILED,
      status: AUDIT_STATUSES.FAILURE,
      scanId: uploadSessionId,
      targetName: scanLabel || 'binary_scan',
      req,
      reason: err.message || 'Binary scan failed',
      details: { error: err.message },
    });
    next(err);
  }
});

// --------------------------------------------------------------------------
// 4. POST /cbom/merge
// --------------------------------------------------------------------------
router.post('/cbom/merge', RATE_LIMITS.cbomGeneration.middleware(), async (req, res, next) => {
  try {
    let components = [];
    const seenRefs = new Set();

    // If explicit CBOMs provided in request body
    if (Array.isArray(req.body?.cboms)) {
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
      // Collect from real scans run in this session scoped to tenant
      const allScans = await getAllScans(req.tenantContext);
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
      scenario: req.body?.scenario || 'baseline',
      tenantContext: req.tenantContext
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
      const latest = getLatestScan(req.tenantContext);
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
      scanName: req.body?.scan_name || 'Quantum Risk Analysis',
      tenantContext: req.tenantContext
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
    const latest = getLatestScan(req.tenantContext);
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
    const latest = getLatestScan(req.tenantContext);
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
    const latest = getLatestScan(req.tenantContext);
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
