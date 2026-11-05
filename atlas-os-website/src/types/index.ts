export type ReleaseStatus = 'available' | 'coming_soon' | 'archived';

export interface MinimumRequirements {
  os: string;
  processor: string;
  ram: string;
  storage: string;
  display: string;
  architecture: string;
}

export interface ReleaseManifest {
  platform: 'Windows' | 'macOS' | 'Linux';
  platformLabel: string;
  version: string;
  releaseDate: string | null;
  status: ReleaseStatus;
  fileSize: string | null;
  downloadUrl: string | null;
  checksumSha256: string | null;
  isDigitallySigned: boolean;
  signatureIssuer?: string | null;
  minimumRequirements: MinimumRequirements;
  releaseNotes: string[];
}

export type FeatureStatus = 'production' | 'in_development' | 'planned';

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  category: 'inventory' | 'sales' | 'invoicing' | 'customers' | 'payments' | 'dashboard' | 'reports' | 'security' | 'ai';
  status: FeatureStatus;
  statusLabel: string;
  iconName: string;
  highlights: string[];
  metrics?: string;
}

export interface IndustrySolution {
  id: string;
  title: string;
  badge: string;
  tagline: string;
  description: string;
  commonChallenges: string[];
  howAtlasSolves: string[];
  workflowHighlights: {
    step: string;
    description: string;
  }[];
}

export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  badge?: string;
  statusText: string;
  priceDisplay: string;
  billingPeriod: string;
  description: string;
  isFeatured: boolean;
  features: {
    name: string;
    included: boolean;
    note?: string;
  }[];
  ctaText: string;
  ctaHref: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category: 'General' | 'Product & Features' | 'Security & Compliance' | 'Download & Deployment' | 'Pricing & Trials';
}

export interface DemoRequestPayload {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  industry: string;
  businessSize: string;
  city: string;
  primaryRequirement: string;
  additionalMessage?: string;
}
