/**
 * Output Encoding & XSS Defenses — Phase 17.3
 *
 * Provides contextual output encoding, dangerous payload neutralization,
 * prototype pollution defense, and HTML sanitization for DOM rendering.
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escapes characters with special meaning in HTML body context to neutralize XSS.
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/[&<>"'/`=]/g, (char) => HTML_ENTITY_MAP[char] || char);
}

/**
 * Escapes characters suitable for insertion inside HTML attribute values.
 */
export function escapeHtmlAttr(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  // Neutralize quotes, ampersands, angle brackets, and whitespace/control characters
  return str.replace(/[^a-zA-Z0-9.\-_]/g, (char) => {
    return `&#x${char.charCodeAt(0).toString(16)};`;
  });
}

/**
 * Escapes strings intended to be placed inside JavaScript strings.
 */
export function escapeJsString(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/["'\\/\r\n\u2028\u2029<>&]/g, (char) => {
    switch (char) {
      case '"':
        return '\\"';
      case "'":
        return "\\'";
      case '\\':
        return '\\\\';
      case '/':
        return '\\/';
      case '\r':
        return '\\r';
      case '\n':
        return '\\n';
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      default:
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
}

/**
 * Strips dangerous HTML tags, inline scripts, event handlers, and data/javascript URIs.
 */
export function stripDangerousTags(html: string): string {
  if (!html || typeof html !== 'string') return '';

  return html
    // Remove script tags and their content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove style tags and their content
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove dangerous executable or embedding tags
    .replace(/<\/?(iframe|object|embed|applet|meta|link|base|form|svg|math)\b[^>]*>/gi, '')
    // Remove inline event handlers (onerror, onload, onclick, onmouseover, etc.)
    .replace(/\s*on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    // Remove javascript: and vbscript: URIs
    .replace(/(?:href|src|data|action)\s*=\s*['"]?(?:javascript|vbscript|data):[^'"]*['"]?/gi, '');
}

/**
 * Sanitizes plain text input by stripping control characters and null bytes.
 */
export function sanitizePlainText(input: string): string {
  if (!input || typeof input !== 'string') return '';
  // Strip NULL bytes and control characters (except tab, LF, CR)
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Neutralize Unicode direction override characters (prevents Trojan Source attacks)
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
}

/**
 * Deeply sanitizes JSON objects, preventing prototype pollution and recursive poisoning.
 */
export function sanitizeJson<T>(data: T): T {
  if (data === null || typeof data !== 'object') {
    if (typeof data === 'string') {
      return sanitizePlainText(data) as unknown as T;
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeJson(item)) as unknown as T;
  }

  const cleanObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    // Defend against prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cleanObj[key] = sanitizeJson(value);
  }

  return cleanObj as T;
}
