/** Last finished dictation, consumed by clipboard:copyResult. */
export const lastResult: { id: string | null; text: string } = { id: null, text: '' };

/**
 * Restore stack (§3.1 rule 8: the user's words are never lost). Holds the
 * last few results/failed transcripts in memory for copy/recovery.
 */
const STACK_LIMIT = 5;
const stack: { id: string; text: string }[] = [];

export function pushRestoreStack(id: string, text: string): void {
  if (!text.trim()) return;
  stack.unshift({ id, text });
  if (stack.length > STACK_LIMIT) stack.pop();
}

export function findRestorable(id: string): string | null {
  return stack.find((item) => item.id === id)?.text ?? null;
}
