import fs from 'node:fs';
import path from 'node:path';
import type { DictionaryTerm } from '@flow/shared';

/**
 * Personal dictionary, local-first (F10). Terms ride along with every
 * session.start — Deepgram keyword boosting + LLM "spell exactly" injection.
 * Server-side sync + use-count ranking arrive with Phase 17.
 */

const MAX_TERMS = 500;
/** Cap sent per session (§2 F10: prompt injection stays bounded). */
export const SESSION_TERM_LIMIT = 50;

export class DictionaryService {
  private terms: DictionaryTerm[] = [];
  private readonly filePath: string;

  constructor(dir: string) {
    this.filePath = path.join(dir, 'dictionary.json');
    this.load();
  }

  list(): DictionaryTerm[] {
    return [...this.terms];
  }

  /** Newest-first slice sent with session.start. */
  forSession(): string[] {
    return this.terms.slice(0, SESSION_TERM_LIMIT).map((t) => t.phrase);
  }

  add(phrase: string, hint?: string): void {
    const clean = phrase.trim();
    if (!clean || clean.length > 80) return;
    if (this.terms.some((t) => t.phrase.toLowerCase() === clean.toLowerCase())) return;
    this.terms.unshift({
      phrase: clean,
      ...(hint?.trim() ? { hint: hint.trim() } : {}),
      addedAt: new Date().toISOString(),
    });
    if (this.terms.length > MAX_TERMS) this.terms.pop();
    this.persist();
  }

  remove(phrase: string): void {
    const before = this.terms.length;
    this.terms = this.terms.filter((t) => t.phrase.toLowerCase() !== phrase.toLowerCase());
    if (this.terms.length !== before) this.persist();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      this.terms = Array.isArray(raw)
        ? (raw as DictionaryTerm[]).filter((t) => typeof t?.phrase === 'string')
        : [];
    } catch {
      this.terms = [];
    }
  }

  private persist(): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.terms, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
