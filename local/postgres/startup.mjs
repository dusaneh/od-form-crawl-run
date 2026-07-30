const RETRYABLE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

const RETRYABLE_MESSAGES = [
  /connection terminated/i,
  /connection timeout/i,
  /connection refused/i,
  /connection reset/i,
  /could not connect/i,
  /server closed the connection/i,
  /terminating connection/i,
  /timeout expired/i,
];

function errorChain(error) {
  const output = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    output.push(current);
    current = current.cause;
  }
  return output;
}

export function isRetryableDatabaseStartupError(error) {
  return errorChain(error).some(
    (candidate) =>
      RETRYABLE_CODES.has(String(candidate?.code || "")) ||
      RETRYABLE_MESSAGES.some((pattern) =>
        pattern.test(String(candidate?.message || "")),
      ),
  );
}

export async function retryDatabaseStartup(
  operation,
  {
    attempts = 4,
    delaysMs = [1_000, 3_000, 7_000],
    onRetry = () => {},
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (
        attempt >= attempts ||
        !isRetryableDatabaseStartupError(error)
      ) {
        throw error;
      }
      const delayMs =
        delaysMs[Math.min(attempt - 1, Math.max(delaysMs.length - 1, 0))] || 0;
      await onRetry({ attempt, delayMs, error });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
