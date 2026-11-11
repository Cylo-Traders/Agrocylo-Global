import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { captureAlert } = vi.hoisted(() => ({ captureAlert: vi.fn() }));
vi.mock('../config/sentry.js', () => ({ captureAlert }));

import { recordResponseStatus, _resetForTests } from './errorRateMonitor.js';

describe('errorRateMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTests();
  });

  it('ignores non-5xx statuses entirely', () => {
    for (let i = 0; i < 50; i++) recordResponseStatus(404);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it('does not alert below the threshold count', () => {
    for (let i = 0; i < 9; i++) recordResponseStatus(500);
    expect(captureAlert).not.toHaveBeenCalled();
  });

  it('alerts once the threshold is crossed within the window', () => {
    for (let i = 0; i < 10; i++) recordResponseStatus(503);
    expect(captureAlert).toHaveBeenCalledTimes(1);
    expect(captureAlert).toHaveBeenCalledWith(
      'elevated_5xx_rate',
      expect.stringContaining('10 5xx responses'),
      expect.objectContaining({ count: 10 })
    );
  });

  it('does not re-alert again within the cooldown window', () => {
    for (let i = 0; i < 15; i++) recordResponseStatus(500);
    expect(captureAlert).toHaveBeenCalledTimes(1);
  });
});
