import { describe, expect, it } from 'vitest';
import {
  applyMarkdownLinePrefix,
  isCursorInsideInlineMarkdown,
  toggleInlineMarkdown
} from './markdownEditor.js';

describe('markdown editor formatting', () => {
  it('bolds only the selected text and preserves the selection', () => {
    expect(toggleInlineMarkdown('one two three', 4, 7, '**')).toEqual({
      content: 'one **two** three',
      selectionStart: 6,
      selectionEnd: 9
    });
  });

  it('removes bold from an already wrapped selection', () => {
    expect(toggleInlineMarkdown('one **two** three', 6, 9, '**')).toEqual({
      content: 'one two three',
      selectionStart: 4,
      selectionEnd: 7
    });
  });

  it('opens a typing format and toggles it off by moving after the closing marker', () => {
    const opened = toggleInlineMarkdown('Start ', 6, 6, '**');
    expect(opened).toEqual({ content: 'Start ****', selectionStart: 8, selectionEnd: 8 });
    const withText = 'Start **bold words**';
    expect(isCursorInsideInlineMarkdown(withText, 18, '**')).toBe(true);
    expect(toggleInlineMarkdown(withText, 18, 18, '**')).toEqual({
      content: withText,
      selectionStart: 20,
      selectionEnd: 20
    });
  });

  it('does not confuse strong markers with italic cursor state', () => {
    expect(isCursorInsideInlineMarkdown('A **bold** word', 5, '*')).toBe(false);
    expect(isCursorInsideInlineMarkdown('A *soft* word', 5, '*')).toBe(true);
  });

  it('applies and removes block prefixes across all selected lines', () => {
    const applied = applyMarkdownLinePrefix('First\nSecond', 0, 12, '- ');
    expect(applied.content).toBe('- First\n- Second');
    const removed = applyMarkdownLinePrefix(applied.content, 2, applied.content.length, '- ');
    expect(removed.content).toBe('First\nSecond');
  });
});
