import type { ReleaseManifest } from '../types';

/**
 * Authoritative Software Release Manifest
 * 
 * Truthful Architecture:
 * No fake .exe or .msi installers are fabricated. 
 * Atlas OS Desktop is planned; no packaged release is available.
 * This manifest drives the Download Center with 100% transparency.
 */
export const OFFICIAL_RELEASES: ReleaseManifest[] = [
  {
    platform: 'Windows',
    platformLabel: 'Windows 11 / 10 (64-bit)',
    version: 'Planned — no released version',
    releaseDate: null, // Unreleased desktop binary
    status: 'coming_soon',
    fileSize: null,
    downloadUrl: null, // Null until verified production binary is published
    checksumSha256: null,
    isDigitallySigned: false,
    signatureIssuer: null,
    minimumRequirements: {
      os: 'Windows 10 Version 1903 or higher, Windows 11',
      processor: 'x64 Architecture (Intel Core i3 / AMD Ryzen 3 or higher)',
      ram: '4 GB minimum (8 GB recommended for heavy reporting)',
      storage: '500 MB free hard drive space',
      display: '1366 x 768 minimum resolution (1920 x 1080 recommended)',
      architecture: '64-bit Windows Desktop',
    },
    releaseNotes: ['Native packaging and hardware integrations are planned, not released features.'],
  },
  {
    platform: 'macOS',
    platformLabel: 'macOS Sonoma / Ventura',
    version: 'Planned',
    releaseDate: null,
    status: 'coming_soon',
    fileSize: null,
    downloadUrl: null,
    checksumSha256: null,
    isDigitallySigned: false,
    minimumRequirements: {
      os: 'macOS 13.0 (Ventura) or newer',
      processor: 'Apple Silicon (M1/M2/M3/M4) or Intel Core i5',
      ram: '8 GB unified memory',
      storage: '500 MB disk space',
      display: 'Retina display recommended',
      architecture: 'Universal Binary (ARM64 & x86_64)',
    },
    releaseNotes: ['Native packaging and hardware integrations are planned, not released features.'],
  },
];

/**
 * Configurable Environment Links
 */
export const APP_CONFIG = {
  // Configurable URL for web application (can be overridden via PUBLIC_APP_URL)
  webAppUrl: import.meta.env.PUBLIC_APP_URL || '',
  companyName: 'Atlas OS',
  officialDomain: 'atlas-os-8328y.web.app',
  supportEmail: import.meta.env.PUBLIC_SUPPORT_EMAIL || '',
  salesEmail: import.meta.env.PUBLIC_SALES_EMAIL || '',
  headquarters: 'India',
  githubUrl: 'https://github.com/YenugantiVijay/Atlas-OS',
};
