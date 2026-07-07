import type { LlmProvider } from './llm.js';
import type { PromptContext } from './prompt.js';
import { buildFormattingSystemPrompt } from './prompt.js';
import { ruleFormat } from './rule-format.js';

/**
 * Formatting orchestration (BLUEPRINT §12.2, §12.6 shortcuts):
 *  - ≤3 words or no provider → rule-based only (no LLM round-trip)
 *  - LLM failure/timeout → rule-based, `formatted:false` — degrade, never block
 */

const MIN_WORDS_FOR_LLM = 4;
const TOTAL_BUDGET_MS = 8_000;

export interface FormatResult {
  text: string;
  formatted: boolean;
}

export class FormattingService {
  constructor(private readonly provider: LlmProvider | null) {}

  get providerName(): string {
    return this.provider?.name ?? 'rules-only';
  }

  async format(rawText: string, ctx: PromptContext): Promise<FormatResult> {
    const trimmed = rawText.trim();
    if (!trimmed) return { text: '', formatted: false };

    const wordCount = trimmed.split(/\s+/).length;
    if (!this.provider || wordCount < MIN_WORDS_FOR_LLM) {
      return { text: ruleFormat(trimmed), formatted: false };
    }

    try {
      const output = await withTimeout(
        this.provider.complete({
          system: buildFormattingSystemPrompt(ctx),
          user: trimmed,
          maxTokens: clamp(Math.ceil(wordCount * 2.5) + 50, 128, 4_096),
        }),
        TOTAL_BUDGET_MS,
      );
      const text = sanitize(output);
      if (!text) throw new Error('empty LLM output');
      return { text, formatted: true };
    } catch (err) {
      console.warn(
        `[formatter] degraded to rules (${err instanceof Error ? err.message : 'error'})`,
      );
      return { text: ruleFormat(trimmed), formatted: false };
    }
  }
}

/** Strip wrappers a model occasionally adds despite instructions. */
export function sanitize(output: string): string {
  let text = output.trim();
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1]!.trim();
  if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
