import Anthropic from '@anthropic-ai/sdk';

/**
 * LLM provider abstraction (BLUEPRINT §12.4). The formatter only talks to
 * this interface; Anthropic is primary, a second vendor slots in later for
 * outage isolation.
 */

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<string>;
}

/**
 * Claude formatting provider. Model defaults to Haiku — the §12.1 choice for
 * the formatting tier (TTFT is the product; see the §12.5 latency budget).
 * No sampling params: formatting needs determinism-ish defaults, and omitting
 * them keeps the request valid on every current model if ANTHROPIC_MODEL is
 * overridden.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5',
  ) {
    this.name = `anthropic:${this.model}`;
    // timeout is milliseconds in the TS SDK; total request budget per §12.5.
    this.client = new Anthropic({ apiKey, timeout: 8_000, maxRetries: 0 });
  }

  async complete(req: LlmRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }
    return text;
  }
}
