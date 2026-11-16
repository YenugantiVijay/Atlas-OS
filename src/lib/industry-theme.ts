import type { CSSProperties } from 'react';
import type { BusinessCategory } from '@/types';

const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const palettes = {
  electrical: ['fffbeb', 'fef3c7', 'fde68a', 'fcd34d', 'fbbf24', 'f59e0b', 'b45309', '92400e', '78350f', '652a0c'],
  electronics: ['eff6ff', 'dbeafe', 'bfdbfe', '93c5fd', '60a5fa', '3b82f6', '1d4ed8', '1e40af', '1e3a8a', '172554'],
  hardware: ['fff7ed', 'ffedd5', 'fed7aa', 'fdba74', 'fb923c', 'f97316', 'c2410c', '9a3412', '7c2d12', '652710'],
  wholesale: ['ecfeff', 'cffafe', 'a5f3fc', '67e8f9', '22d3ee', '06b6d4', '0e7490', '155e75', '164e63', '113d4b'],
  agriculture: ['f0fdf4', 'dcfce7', 'bbf7d0', '86efac', '4ade80', '22c55e', '15803d', '166534', '14532d', '103d24'],
  ecommerce: ['f5f3ff', 'ede9fe', 'ddd6fe', 'c4b5fd', 'a78bfa', '8b5cf6', '6d28d9', '5b21b6', '4c1d95', '3b1677'],
};
const categoryPalette: Partial<Record<BusinessCategory, keyof typeof palettes>> = {
  electrical_retail: 'electrical',
  electrical_wholesale_distributor: 'electrical',
  electronics_trade: 'electronics',
  hardware_trade: 'hardware',
  hardware_electrical: 'hardware',
  general_wholesale: 'wholesale',
  agricultural_inputs: 'agriculture',
  ecommerce: 'ecommerce',
};

export function industryTheme(category: BusinessCategory | null | undefined): CSSProperties | undefined {
  const palette = category && categoryPalette[category];
  if (!palette) return undefined;
  const colors = palettes[palette];
  return Object.fromEntries(shades.map((shade, index) => [
    '--atlas-' + shade,
    [0, 2, 4].map(offset => Number.parseInt(colors[index].slice(offset, offset + 2), 16)).join(' '),
  ]));
}
