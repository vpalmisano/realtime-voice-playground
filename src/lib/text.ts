import { EventEmitter } from 'events';
import debug from 'debug';

export const LLM_TEXT_AGGREGATIONS = ['full', 'sentence'] as const;

export type LLMTextAggregation = (typeof LLM_TEXT_AGGREGATIONS)[number];

export const LLM_TEXT_AGGREGATION_DEFAULT: LLMTextAggregation = 'sentence';

const log = debug('realtime:text-aggregator');

export class TextAggregator extends EventEmitter {
  private text = '';
  private textAggregation: LLMTextAggregation;

  constructor(textAggregation: LLMTextAggregation = LLM_TEXT_AGGREGATION_DEFAULT) {
    super();
    this.textAggregation = textAggregation;
  }

  append(text: string) {
    this.text += text;
    if (this.textAggregation === 'sentence') {
      // Emit on . ! ? (and combinations like !? / ...) followed by whitespace.
      const completeSentence = /^([\s\S]*?[.!?]+)(\s+)/;
      let match: RegExpMatchArray | null;
      while ((match = this.text.match(completeSentence))) {
        const sentence = match[1] + match[2];
        log('emit text="%s"', sentence);
        this.emit('text', sentence);
        this.text = this.text.slice(sentence.length);
      }
    }
  }

  flush() {
    log('flush text="%s"', this.text);
    if (this.text) {
      this.emit('text', this.text);
      this.text = '';
    }
  }

  clear() {
    this.text = '';
  }
}
