export const ERROR_CODES = {
  INVALID_URL: 'INVALID_URL',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  HTTPS_REQUIRED: 'HTTPS_REQUIRED',
} as const;

export class UrlValidationError extends Error {
  constructor(
    message: string,
    public code: keyof typeof ERROR_CODES
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}
