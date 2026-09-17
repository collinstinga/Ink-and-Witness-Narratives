import { describe, expect, it } from 'vitest';
import { chooseNarrationVoice, cleanTextForNarration, splitNarrationText } from './narration.js';

describe('narration text', () => {
  it('removes markdown formatting but keeps punctuation and spoken prose', () => {
    expect(cleanTextForNarration('# A quiet beginning\n> “Wait,” she whispered.\n- **First**, listen!\nThen [read on](https://example.com).'))
      .toBe('A quiet beginning. “Wait,” she whispered. First, listen! Then read on.');
  });

  it('does not narrate image URLs or fenced code', () => {
    expect(cleanTextForNarration('A scene. ![cover](https://example.com/cover.jpg)\n```ts\nconsole.log("secret")\n```\n*The end.*'))
      .toBe('A scene. The end.');
  });

  it('groups sentences without dropping punctuation or words', () => {
    const text = 'A short opening. The rain falls steadily, and everyone listens. What happens next? The room goes quiet.';
    const chunks = splitNarrationText(text, 55);
    expect(chunks.every((chunk) => chunk.length <= 55)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('splits a long sentence on a clause or word boundary', () => {
    const text = 'At the edge of the village, the thoughtful narrator quietly watched the gathering clouds move across the hills';
    const chunks = splitNarrationText(text, 46);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 46)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('ignores empty input', () => {
    expect(splitNarrationText(' \n ')).toEqual([]);
  });
});

describe('narration voice selection', () => {
  const voice = (name: string, lang: string) => ({ name, lang, voiceURI: name });

  it('prefers an advertised natural English voice over a generic voice', () => {
    const plain = voice('Generic English', 'en-US');
    const natural = voice('Microsoft Aria Online (Natural)', 'en-US');
    expect(chooseNarrationVoice([plain, natural])).toBe(natural);
  });

  it('keeps narration in English even if another language has a natural voice', () => {
    const french = voice('French Natural', 'fr-FR');
    const english = voice('English', 'en-GB');
    expect(chooseNarrationVoice([french, english])).toBe(english);
  });

  it('falls back safely when no English voice exists', () => {
    const first = voice('First', 'fr-FR');
    expect(chooseNarrationVoice([first])).toBe(first);
    expect(chooseNarrationVoice([])).toBeUndefined();
  });
});
