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

async function withRetry(fn, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 200, 16000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

module.exports = { GeminiError, isRetryable, withRetry };
