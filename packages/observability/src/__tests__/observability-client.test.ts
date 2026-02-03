import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestTimer, ObservabilityClient } from '../index';

describe('ObservabilityClient', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with service name and environment', () => {
      const obs = new ObservabilityClient('test-service', 'production');
      expect(obs).toBeInstanceOf(ObservabilityClient);
    });

    it('should default to development environment', () => {
      const obs = new ObservabilityClient('test-service');
      obs.debug('test message');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });
  });

  describe('log levels', () => {
    it('should log info messages', () => {
      const obs = new ObservabilityClient('test-service');
      obs.info('test info message', { key: 'value' });

      expect(consoleSpy.info).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.level).toBe('info');
      expect(loggedData.message).toBe('test info message');
      expect(loggedData.service).toBe('test-service');
    });

    it('should log warn messages', () => {
      const obs = new ObservabilityClient('test-service');
      obs.warn('test warning');

      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.warn.mock.calls[0]?.[0] as string
      );
      expect(loggedData.level).toBe('warn');
    });

    it('should log error messages', () => {
      const obs = new ObservabilityClient('test-service');
      obs.error('test error');

      expect(consoleSpy.error).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.error.mock.calls[0]?.[0] as string
      );
      expect(loggedData.level).toBe('error');
    });

    it('should only log debug in development', () => {
      const devObs = new ObservabilityClient('test', 'development');
      const prodObs = new ObservabilityClient('test', 'production');

      devObs.debug('dev debug');
      prodObs.debug('prod debug');

      expect(consoleSpy.debug).toHaveBeenCalledOnce();
    });
  });

  describe('trackRequest', () => {
    it('should track request metrics', () => {
      const obs = new ObservabilityClient('api-service');
      obs.trackRequest({
        url: '/api/test',
        method: 'GET',
        duration: 150,
        status: 200,
        userAgent: 'test-agent',
      });

      expect(consoleSpy.info).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.metadata.url).toBe('/api/test');
      expect(loggedData.metadata.duration).toBe(150);
      expect(loggedData.metadata.status).toBe(200);
    });
  });

  describe('trackError', () => {
    it('should track errors with context', () => {
      const obs = new ObservabilityClient('error-service');
      const error = new Error('Test error');

      obs.trackError(error, {
        url: '/api/fail',
        method: 'POST',
      });

      expect(consoleSpy.error).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.error.mock.calls[0]?.[0] as string
      );
      expect(loggedData.message).toBe('Test error');
      expect(loggedData.metadata.url).toBe('/api/fail');
      expect(loggedData.metadata.name).toBe('Error');
    });
  });

  describe('createRequestTimer', () => {
    it('should measure request duration', () => {
      const obs = new ObservabilityClient('timer-service');
      const timer = createRequestTimer(obs, {
        url: '/api/timed',
        method: 'POST',
        headers: {
          get: (key: string) => (key === 'user-agent' ? 'test-ua' : null),
        },
      });

      timer.end(200);

      expect(consoleSpy.info).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(loggedData.metadata.status).toBe(200);
    });
  });

  describe('requestId correlation', () => {
    it('should include requestId in log output when set', () => {
      const obs = new ObservabilityClient('test-service');
      obs.setRequestId('req-abc-123');
      obs.info('correlated log');

      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.requestId).toBe('req-abc-123');
    });

    it('should not include requestId when not set', () => {
      const obs = new ObservabilityClient('test-service');
      obs.info('uncorrelated log');

      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData).not.toHaveProperty('requestId');
    });

    it('should include requestId across all log levels', () => {
      const obs = new ObservabilityClient('test-service');
      obs.setRequestId('req-levels-456');

      obs.info('info msg');
      obs.warn('warn msg');
      obs.error('error msg');

      for (const [level, spy] of [
        ['info', consoleSpy.info],
        ['warn', consoleSpy.warn],
        ['error', consoleSpy.error],
      ] as const) {
        const loggedData = JSON.parse(spy.mock.calls[0]?.[0] as string);
        expect(loggedData.requestId).toBe('req-levels-456');
      }
    });

    it('should include requestId in trackError output', () => {
      const obs = new ObservabilityClient('test-service');
      obs.setRequestId('req-err-789');
      obs.trackError(new Error('fail'), { url: '/test' });

      const loggedData = JSON.parse(
        consoleSpy.error.mock.calls[0]?.[0] as string
      );
      expect(loggedData.requestId).toBe('req-err-789');
    });

    it('should include requestId in trackRequest output', () => {
      const obs = new ObservabilityClient('test-service');
      obs.setRequestId('req-track-000');
      obs.trackRequest({
        url: '/api/test',
        method: 'GET',
        duration: 50,
        status: 200,
      });

      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.requestId).toBe('req-track-000');
    });
  });

  describe('redaction', () => {
    it('should redact sensitive data from metadata', () => {
      const obs = new ObservabilityClient('secure-service', 'production');
      obs.info('sensitive log', {
        password: 'secret123',
        username: 'john',
      });

      expect(consoleSpy.info).toHaveBeenCalledOnce();
      const loggedData = JSON.parse(
        consoleSpy.info.mock.calls[0]?.[0] as string
      );
      expect(loggedData.metadata.password).toBe('[REDACTED]');
      expect(loggedData.metadata.username).toBe('john');
    });
  });
});
