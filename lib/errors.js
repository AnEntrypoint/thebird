class GeminiError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function isRetryable(err) {
  if (err instanceof GeminiError) return err.retryable;
  const status = err?.status ?? err?.code;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  const msg = err?.message ?? '';
  return /quota|rate.?limit|overloaded|unavailable/i.test(msg);
}

function parseRetryDelay(err) {
  try {
    const body = typeof err.message === 'string' ? JSON.parse(err.message) : err.message;
    const details = body?.error?.details || [];
    const retryInfo = details.find(d => d['@type']?.includes('RetryInfo'));
    if (retryInfo?.retryDelay) {
      const secs = parseFloat(retryInfo.retryDelay);
      if (!isNaN(secs)) return secs * 1000;
    }
  } catch (_) {}
  return null;
}

async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) throw err;
      const suggested = parseRetryDelay(err);
      const delay = suggested != null ? suggested + Math.random() * 1000 : Math.min(1000 * 2 ** attempt + Math.random() * 200, 16000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { GeminiError, isRetryable, withRetry };
