import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { BrandLogo } from './BrandLogo';

describe('Atlas OS official brand alignment', () => {
  it('reuses the exact website SVG as the application favicon', () => {
    const web = readFileSync('atlas-os-website/public/favicon.svg', 'utf8');
    const tool = readFileSync('public/favicon.svg', 'utf8');
    expect(tool).toBe(web);
    expect(tool).toContain('#142B4D');
    expect(tool).toContain('#2DD4BF');
  });

  it('shows the official icon in both normal and collapsed sidebar layouts', () => {
    const { rerender } = render(<BrandLogo variant="dark" />);
    expect(screen.getByRole('img', { name: 'Atlas OS logo' })).toHaveAttribute('src', '/favicon.svg');
    expect(screen.getByText('ATLAS')).toBeInTheDocument();
    rerender(<BrandLogo collapsed variant="dark" />);
    expect(screen.getByRole('img', { name: 'Atlas OS logo' })).toBeInTheDocument();
    expect(screen.queryByText('ATLAS')).not.toBeInTheDocument();
  });
});
