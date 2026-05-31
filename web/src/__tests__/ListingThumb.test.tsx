import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListingThumb } from '../components/ui/ListingThumb.js';

describe('ListingThumb', () => {
  it('renders the CDN image with no-referrer when src is present', () => {
    render(<ListingThumb id="A" src="https://cdn/1.jpg" alt="Casa A" />);
    const img = screen.getByRole('img', { name: 'Casa A' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn/1.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('falls back to the placeholder when src is null', () => {
    render(<ListingThumb id="A" src={null} label="photo" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('photo')).toBeInTheDocument();
  });

  it('falls back to the placeholder when the image fails to load (deleted on 999)', () => {
    render(<ListingThumb id="A" src="https://cdn/gone.jpg" label="photo" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('photo')).toBeInTheDocument();
  });
});
