type LogDetails = Record<string, string | number | boolean | null | undefined>;

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function formatDetails(details?: LogDetails): string {
  if (!details) {
    return "";
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return ` | ${parts.join(" | ")}`;
}

function log(level: "INFO" | "WARN" | "ERROR", scope: string, event: string, details?: LogDetails): void {
  const ts = new Date().toISOString();
  console.log(`${ts} | ${level} | ${scope} | ${event}${formatDetails(details)}`);
}

export function logInfo(scope: string, event: string, details?: LogDetails): void {
  log("INFO", scope, event, details);
}

export function logWarn(scope: string, event: string, details?: LogDetails): void {
  log("WARN", scope, event, details);
}

export function logError(scope: string, event: string, details?: LogDetails): void {
  log("ERROR", scope, event, details);
}
