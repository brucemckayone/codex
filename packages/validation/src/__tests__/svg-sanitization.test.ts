import { describe, expect, it } from 'vitest';
import { sanitizeSvgContent } from '../primitives';

describe('sanitizeSvgContent', () => {
  it('should preserve safe SVG content', () => {
    const safeSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="blue"/>
      </svg>
    `;

    const result = sanitizeSvgContent(safeSvg);
    expect(result).toContain('<svg');
    expect(result).toContain('<circle');
    expect(result).toContain('fill="blue"');
  });

  it('should remove <script> tags', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('XSS')</script>
        <circle cx="50" cy="50" r="40"/>
      </svg>
    `;

    const result = sanitizeSvgContent(maliciousSvg);
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).toContain('<circle'); // Safe content preserved
  });

  it('should remove event handler attributes', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="40" onclick="alert('XSS')"/>
      </svg>
    `;

    const result = sanitizeSvgContent(maliciousSvg);
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('alert');
  });

  it('should block javascript: URIs', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <a href="javascript:alert('XSS')">
          <circle cx="50" cy="50" r="40"/>
        </a>
      </svg>
    `;

    const result = sanitizeSvgContent(maliciousSvg);
    expect(result).not.toContain('javascript:');
  });

  it('should block <foreignObject> embedding', () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <foreignObject>
          <body><script>alert('XSS')</script></body>
        </foreignObject>
      </svg>
    `;

    const result = sanitizeSvgContent(maliciousSvg);
    expect(result).not.toContain('foreignObject');
    expect(result).not.toContain('<body>');
  });

  it('should throw error for completely malicious SVG (empty after sanitization)', () => {
    const maliciousSvg = '<script>alert("XSS")</script>';

    expect(() => sanitizeSvgContent(maliciousSvg)).toThrow('empty content');
  });

  it('should allow safe SVG elements like path and linearGradient', () => {
    const complexSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="grad1">
            <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
          </linearGradient>
        </defs>
        <path d="M10 10 H 90 V 90 H 10 L 10 10" fill="url(#grad1)"/>
      </svg>
    `;

    const result = sanitizeSvgContent(complexSvg);
    expect(result).toContain('<path');
    expect(result).toContain('linearGradient');
    expect(result).toContain('<stop');
  });
});
