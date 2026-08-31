import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';

// Mock Sentry with the v8 API surface
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  startSpan: vi.fn((_options: unknown, callback: (span: unknown) => unknown) =>
    callback({ setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }),
  ),
  setTag: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  expressIntegration: vi.fn(),
  setupExpressErrorHandler: vi.fn(),
}));

describe('Observability Configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('./index.js', () => ({
      config: { nodeEnv: 'production', sentryDsn: '', sentryTracesSampleRate: 0.1 },
    }));
    vi.doMock('./logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    delete process.env.SENTRY_DSN;
  });

  describe('Sentry initialization', () => {
    it('should skip initialization if SENTRY_DSN is not set', async () => {
      const { initializeSentry } = await import('./observability.js');
      initializeSentry('api');
      expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('should initialize Sentry with production config when SENTRY_DSN is set', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      const { initializeSentry } = await import('./observability.js');
      initializeSentry('api');

      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          dsn: 'https://key@sentry.io/project',
          environment: 'production',
        }),
      );
    });

    it('should set process type tag', async () => {
      process.env.SENTRY_DSN = 'https://key@sentry.io/project';

      const { initializeSentry } = await import('./observability.js');
      initializeSentry('worker');

      expect(Sentry.setTag).toHaveBeenCalledWith('process_type', 'worker');
    });
  });

  describe('Sensitive data scrubbing', () => {
    it('should scrub wallet addresses from strings', async () => {
      const { SENSITIVE_PATTERNS } = await import('./observability.js');
      const testString = 'User GBUQWP3BOUZX34STELLA55MKHXUBZ4JTMCE6ADIIX7A2TCNJCBHHNFM requested access';
      const scrubbed = JSON.stringify(
        { data: testString },
        (key, value) => {
          if (typeof value === 'string') {
            return value
              .replace(SENSITIVE_PATTERNS[0]!, '[WALLET_ADDRESS_REDACTED]')
              .replace(SENSITIVE_PATTERNS[1]!, '[PRIVATE_KEY_REDACTED]');
          }
          return value;
        },
      );

      expect(scrubbed).toContain('[WALLET_ADDRESS_REDACTED]');
      expect(scrubbed).not.toContain('GBUQWP3BOUZX34');
    });

    it('should scrub sensitive object keys', async () => {
      const { scrubSensitiveData } = await import('./sentry.js');
      const testObject = {
        wallet_address: 'GBUQWP3BOUZX34STELLA55MKHXUBZ4JTMCE6ADIIX7A2TCNJCBHHNFM',
        privateKey: 'SBUZXPZ4ZPEZ3F7HWMLMPVJWQFXLWM3YTZVZSFGQX6NLKGMTVNV6F4IV',
        name: 'John Doe',
      };

      const scrubbed = scrubSensitiveData(testObject) as Record<string, unknown>;

      expect(scrubbed).toEqual({
        wallet_address: '[REDACTED]',
        privateKey: '[REDACTED]',
        name: 'John Doe',
      });
    });

    it('should handle nested objects', async () => {
      const { scrubSensitiveData } = await import('./sentry.js');
      const testObject = {
        user: {
          id: '123',
          wallet: 'GBUQWP3BOUZX34STELLA55MKHXUBZ4JTMCE6ADIIX7A2TCNJCBHHNFM',
          metadata: {
            secret_key: 'sensitive',
          },
        },
      };

      const scrubbed = scrubSensitiveData(testObject) as {
        user: { id: string; wallet: string; metadata: { secret_key: string } };
      };

      expect(scrubbed.user.wallet).toBe('[REDACTED]');
      expect(scrubbed.user.metadata.secret_key).toBe('[REDACTED]');
      expect(scrubbed.user.id).toBe('123');
    });
  });

  describe('Trace context extraction', () => {
    it('should extract x-request-id from headers', async () => {
      const { extractTraceContext } = await import('./observability.js');
      const headers = {
        'x-request-id': 'req-12345',
        'user-agent': 'test-client',
      };

      const context = extractTraceContext(headers);

      expect(context['x-request-id']).toBe('req-12345');
    });

    it('should extract traceparent from headers', async () => {
      const { extractTraceContext } = await import('./observability.js');
      const headers = {
        'traceparent': '00-trace-id-span-id-01',
      };

      const context = extractTraceContext(headers);

      expect(context.traceparent).toBe('00-trace-id-span-id-01');
    });

    it('should handle missing headers gracefully', async () => {
      const { extractTraceContext } = await import('./observability.js');
      const headers = {};

      const context = extractTraceContext(headers);

      expect(context).toEqual({});
    });

    it('should ignore array header values', async () => {
      const { extractTraceContext } = await import('./observability.js');
      const headers = {
        'x-request-id': ['id1', 'id2'],
      } as Record<string, string | string[] | undefined>;

      const context = extractTraceContext(headers);

      expect(context['x-request-id']).toBeUndefined();
    });
  });

  describe('Exception capture', () => {
    it('should capture exception with Sentry', async () => {
      const { captureException } = await import('./observability.js');
      const error = new Error('Test error');
      const context = { operation: 'test_op' };

      captureException(error, context);

      expect(Sentry.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          extra: context,
        }),
      );
    });

    it('should capture message with Sentry', async () => {
      const { captureMessage } = await import('./observability.js');
      captureMessage('Test message', 'warning');

      expect(Sentry.captureMessage).toHaveBeenCalledWith('Test message', 'warning');
    });
  });

  describe('Span creation and tracing', () => {
    it('should create span with request ID attribute', async () => {
      const { withSpan } = await import('./observability.js');
      const requestId = 'req-correlation-123';

      await withSpan(
        'test_operation',
        async () => 'result',
        { operation: 'test' },
        requestId,
      );

      expect(Sentry.startSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test_operation',
          op: 'function',
          attributes: expect.objectContaining({ request_id: requestId }),
        }),
        expect.any(Function),
      );
    });

    it('should handle span success', async () => {
      const { withSpan } = await import('./observability.js');
      const result = await withSpan(
        'successful_operation',
        async () => 'success_result',
      );

      expect(result).toBe('success_result');
    });

    it('should handle span errors', async () => {
      const { withSpan } = await import('./observability.js');
      const error = new Error('Operation failed');

      expect(
        withSpan(
          'failing_operation',
          async () => {
            throw error;
          },
        ),
      ).rejects.toThrow('Operation failed');
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
    });
  });
});