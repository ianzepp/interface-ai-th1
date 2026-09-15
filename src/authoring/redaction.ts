const SENSITIVE_KEY =
  /^(api[-_]?key|authorization|cookie|credentials?|password|secret|set-cookie|token)$/i;

export function redactKnownSecrets(value: unknown): unknown {
  return visit(value, new WeakSet());
}

function visit(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => visit(item, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(child, seen);
  }
  return redacted;
}
