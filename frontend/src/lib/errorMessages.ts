export class FriendlyError extends Error {}

export function toUserMessage(err: unknown, fallback: string): string {
  console.error(err)
  return err instanceof FriendlyError ? err.message : fallback
}
