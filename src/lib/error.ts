export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const withMessage = error as { message?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message) {
      return withMessage.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown error";
    }
  }
  return String(error);
}
