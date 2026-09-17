/** Strip presentation markup without removing the punctuation that guides speech. */
export function cleanTextForNarration(text: string): string {
  const withoutBlocks = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}\s*$/gm, ' ');

  return withoutBlocks
    .split(/\n+/)
    .map((line) => {
      const isStructuredLine = /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/.test(line);
      const cleanLine = line
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
        .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

      if (!cleanLine) return '';
      return isStructuredLine && !/[.!?…:;]["'”’)]*$/.test(cleanLine)
        ? `${cleanLine}.`
        : cleanLine;
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep each utterance moderate in size so long paragraphs play reliably. */
export function splitNarrationText(text: string, maxLength = 420): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 420;
  const sentences: string[] = [];
  const sentenceEnd = /[.!?…]+(?:["'”’)]*)?(?=\s+|$)/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceEnd.exec(normalized))) {
    const end = match.index + match[0].length;
    const sentence = normalized.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const trailing = normalized.slice(start).trim();
  if (trailing) sentences.push(trailing);

  const chunks: string[] = [];
  let current = '';
  const append = (part: string) => {
    if (!part) return;
    if (current && current.length + 1 + part.length > limit) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${part}` : part;
  };

  for (const sentence of sentences) {
    let remaining = sentence;
    while (remaining.length > limit) {
      const prefix = remaining.slice(0, limit + 1);
      const punctuationAt = Math.max(prefix.lastIndexOf(', '), prefix.lastIndexOf('; '), prefix.lastIndexOf(': '));
      const wordAt = prefix.lastIndexOf(' ');
      // Prefer a natural clause pause, but never split a word merely to meet the limit.
      const cut = punctuationAt >= Math.floor(limit * 0.55)
        ? punctuationAt + 1
        : wordAt > 0 ? wordAt : remaining.indexOf(' ');
      if (cut < 0) break;
      append(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    append(remaining);
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Voice names are device-specific; prefer advertised natural English voices. */
export function chooseNarrationVoice<T extends { name: string; lang: string; voiceURI: string }>(voices: T[]): T | undefined {
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  const candidates = english.length ? english : voices;
  const qualityScore = (voice: T): number => {
    const identity = `${voice.name} ${voice.voiceURI}`;
    if (/\b(?:natural|neural|enhanced|premium|studio|wavenet)\b/i.test(identity)) return 3;
    if (/\b(?:google|samantha|daniel|serena|aria|jenny)\b/i.test(identity)) return 2;
    return 1;
  };

  return candidates.reduce<T | undefined>((best, voice) => (
    !best || qualityScore(voice) > qualityScore(best) ? voice : best
  ), undefined);
}
