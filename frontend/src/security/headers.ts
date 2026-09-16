/**
 * Secure HTTP Headers Specification — Phase 17.3
 *
 * Defines the enterprise standard HTTP security headers required for ECDAT
 * across development dev-servers, reverse proxies, and production builds.
 */

import { buildCspHeader, PRODUCTION_CSP_DIRECTIVES, DEV_CSP_DIRECTIVES } from './csp';

export interface SecurityHeadersMap {
  [headerName: string]: string;
}

/**
 * Returns complete modern security headers for production deployment.
 */
export function getProductionSecurityHeaders(): SecurityHeadersMap {
  return {
    'Content-Security-Policy': buildCspHeader(PRODUCTION_CSP_DIRECTIVES),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), vr=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
}

/**
 * Returns security headers tuned for Vite development server (enabling HMR while maintaining strict isolation).
 */
export function getDevSecurityHeaders(): SecurityHeadersMap {
  return {
    'Content-Security-Policy': buildCspHeader(DEV_CSP_DIRECTIVES),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
