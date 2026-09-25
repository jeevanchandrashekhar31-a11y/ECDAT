/**
 * ECDAT Archive Security Guard (Node.js Engine)
 *
 * Implements canonical path validation, ZIP binary pre-flight inspection,
 * and security defenses for all uploaded archives:
 * - Zip Slip & path traversal (relative ../, absolute paths, Windows drive letters, UNC paths)
 * - Decompression bombs (expansion ratio caps, per-entry caps, total extraction budget)
 * - Excessive file count exhaustion
 * - Nested archives and recursive decompression attacks
 * - Malformed, corrupt, or truncated archive headers
 * - Unicode NFKC normalization and path bypasses
 * - Windows path traversal, reserved device names (CON, NUL, AUX, etc.), Alternate Data Streams (::$DATA)
 * - Alternate path separators (/ and \)
 */

const path = require("path");
// const fs = require("fs");
const os = require("os");
// const crypto = require("crypto");

// Default bounded security thresholds
const DEFAULT_MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB total
const DEFAULT_MAX_ENTRY_SIZE = 100 * 1024 * 1024; // 100 MB per entry
const DEFAULT_MAX_FILES_COUNT = 100000; // 100,000 files
const DEFAULT_MAX_RATIO = 100.0; // 100:1 max compression ratio

const NESTED_ARCHIVE_EXTS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2", ".xz", ".txz",
  ".7z", ".rar", ".iso", ".jar", ".war", ".ear", ".cpio", ".zst"
]);

const WINDOWS_RESERVED_BASE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*|:.*)?$/i;

class ArchiveSecurityError extends Error {
  constructor(message, code = "ARCHIVE_SECURITY_VIOLATION") {
    super(message);
    this.name = "ArchiveSecurityError";
    this.code = code;
  }
}

class PathTraversalError extends ArchiveSecurityError {
  constructor(message) {
    super(message, "PATH_TRAVERSAL_DETECTED");
    this.name = "PathTraversalError";
  }
}

class DecompressionBombError extends ArchiveSecurityError {
  constructor(message) {
    super(message, "DECOMPRESSION_BOMB_DETECTED");
    this.name = "DecompressionBombError";
  }
}

class NestedArchiveError extends ArchiveSecurityError {
  constructor(message) {
    super(message, "NESTED_ARCHIVE_DETECTED");
    this.name = "NestedArchiveError";
  }
}

class MalformedArchiveError extends ArchiveSecurityError {
  constructor(message) {
    super(message, "MALFORMED_ARCHIVE");
    this.name = "MalformedArchiveError";
  }
}

/**
 * Validates canonical containment of a relative target path inside a dedicated root directory.
 */
function validateCanonicalPathContainment(targetRelativePath, extractionRoot) {
  if (!targetRelativePath || typeof targetRelativePath !== "string") {
    throw new PathTraversalError("Invalid target path.");
  }

  // Unicode NFKC normalization
  const normalized = targetRelativePath.normalize("NFKC");

  // Reject forbidden control bytes
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new PathTraversalError(`Control character detected in archive path: ${JSON.stringify(normalized[i])}`);
    }
  }

  // Reject absolute paths and Windows drive/UNC roots
  if (normalized.startsWith("\\\\") || normalized.startsWith("//")) {
    throw new PathTraversalError(`Windows UNC share path rejected: '${targetRelativePath}'`);
  }
  if (normalized.startsWith("/") || normalized.startsWith("\\")) {
    throw new PathTraversalError(`Absolute path in archive member rejected: '${targetRelativePath}'`);
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new PathTraversalError(`Windows drive letter path rejected: '${targetRelativePath}'`);
  }

  // Normalize separators and check individual segments
  const cleanPath = normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = cleanPath.split("/");

  for (const seg of segments) {
    if (seg.includes(":")) {
      throw new PathTraversalError(`Forbidden Windows Alternate Data Stream (ADS) in member: '${targetRelativePath}'`);
    }
    if (WINDOWS_RESERVED_BASE.test(seg)) {
      throw new PathTraversalError(`Forbidden Windows reserved device name: '${seg}' in '${targetRelativePath}'`);
    }
    if (seg !== "." && seg !== ".." && (seg.endsWith(".") || seg.endsWith(" "))) {
      throw new PathTraversalError(`Prohibited trailing dot or space in segment: '${seg}' in '${targetRelativePath}'`);
    }
  }

  const canonicalRoot = path.resolve(extractionRoot);
  const canonicalTarget = path.resolve(canonicalRoot, cleanPath);
  const rel = path.relative(canonicalRoot, canonicalTarget);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathTraversalError(
      `Path traversal attempt blocked: member '${targetRelativePath}' resolves to '${canonicalTarget}' outside root '${canonicalRoot}'`
    );
  }

  return canonicalTarget;
}

/**
 * Pre-inspects a ZIP archive buffer in memory before extraction.
 * Parses the End of Central Directory (EOCD) and central directory headers.
 */
function validateZipBufferSafety(buffer, options = {}) {
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const maxEntrySize = options.maxEntrySize || DEFAULT_MAX_ENTRY_SIZE;
  const maxFilesCount = options.maxFilesCount || DEFAULT_MAX_FILES_COUNT;
  const maxCompressionRatio = options.maxCompressionRatio || DEFAULT_MAX_RATIO;
  const allowNested = options.allowNested || false;
  const allowSymlinks = options.allowSymlinks || false;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new MalformedArchiveError("Empty or invalid archive buffer.");
  }

  if (buffer.length < 22) {
    throw new MalformedArchiveError("Buffer too small to contain a valid ZIP archive header.");
  }

  // Locate End of Central Directory record (EOCD signature: 0x06054b50)
  // Searching backwards from end of buffer (comment can be up to 65535 bytes)
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new MalformedArchiveError("End of Central Directory (EOCD) record not found. Not a valid ZIP file.");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxFilesCount) {
    throw new DecompressionBombError(
      `Archive declared file count (${totalEntries}) exceeds maximum limit (${maxFilesCount} files).`
    );
  }

  if (centralDirOffset + centralDirSize > eocdOffset || centralDirOffset > buffer.length) {
    throw new MalformedArchiveError("Invalid or corrupt Central Directory pointer in ZIP file.");
  }

  let currentOffset = centralDirOffset;
  let totalUncompressedBytes = 0;
  let fileCount = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (currentOffset + 46 > buffer.length) {
      throw new MalformedArchiveError("Truncated Central Directory file header.");
    }

    const signature = buffer.readUInt32LE(currentOffset);
    if (signature !== 0x02014b50) {
      throw new MalformedArchiveError(`Corrupt Central Directory signature at entry ${i}: 0x${signature.toString(16)}`);
    }

//     const compressedSize = buffer.readUInt32LE(currentOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(currentOffset + 24);
    const fileNameLen = buffer.readUInt16LE(currentOffset + 28);
    const extraLen = buffer.readUInt16LE(currentOffset + 30);
    const commentLen = buffer.readUInt16LE(currentOffset + 32);
    const externalAttr = buffer.readUInt32LE(currentOffset + 38);

    const nameStart = currentOffset + 46;
    if (nameStart + fileNameLen > buffer.length) {
      throw new MalformedArchiveError("Truncated filename in Central Directory header.");
    }

    const rawName = buffer.toString("utf8", nameStart, nameStart + fileNameLen);
    const isDir = rawName.endsWith("/") || rawName.endsWith("\\");

    if (!isDir) {
      fileCount++;
      if (fileCount > maxFilesCount) {
        throw new DecompressionBombError(
          `Archive file count exceeds limit (${maxFilesCount} files).`
        );
      }

      if (uncompressedSize > maxEntrySize) {
        throw new DecompressionBombError(
          `Entry '${rawName}' declared uncompressed size (${uncompressedSize} bytes) exceeds entry limit (${maxEntrySize} bytes).`
        );
      }

      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > maxTotalBytes) {
        throw new DecompressionBombError(
          `Archive total uncompressed size (${totalUncompressedBytes} bytes) exceeds limit (${maxTotalBytes} bytes).`
        );
      }

      // Check for nested archive extension
      if (!allowNested) {
        const ext = path.extname(rawName).toLowerCase();
        if (NESTED_ARCHIVE_EXTS.has(ext)) {
          throw new NestedArchiveError(
            `Nested archive rejected: '${rawName}'. Nested archives are disabled to prevent recursive bombs.`
          );
        }
      }

      // Check for symlink entry in external attributes (Unix mode in top 16 bits)
      const unixMode = (externalAttr >>> 16) & 0xffff;
      const isSymlink = (unixMode & 0o170000) === 0o120000;
      if (isSymlink && !allowSymlinks) {
        throw new PathTraversalError(`Symlink entry in ZIP archive rejected: '${rawName}'`);
      }
    }

    // Path containment and malicious name verification
    validateCanonicalPathContainment(rawName, os.tmpdir());

    currentOffset += 46 + fileNameLen + extraLen + commentLen;
  }

  // Compression ratio calculation
  const overallRatio = totalUncompressedBytes / Math.max(buffer.length, 1);
  if (overallRatio > maxCompressionRatio && totalUncompressedBytes > 1024 * 1024) {
    throw new DecompressionBombError(
      `Excessive compression ratio (${overallRatio.toFixed(1)}:1) exceeds limit (${maxCompressionRatio}:1). Possible zip bomb.`
    );
  }

  return {
    safe: true,
    fileCount,
    totalUncompressedBytes,
    compressionRatio: overallRatio,
  };
}

module.exports = {
  ArchiveSecurityError,
  PathTraversalError,
  DecompressionBombError,
  NestedArchiveError,
  MalformedArchiveError,
  validateCanonicalPathContainment,
  validateZipBufferSafety,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_ENTRY_SIZE,
  DEFAULT_MAX_FILES_COUNT,
  DEFAULT_MAX_RATIO,
};
