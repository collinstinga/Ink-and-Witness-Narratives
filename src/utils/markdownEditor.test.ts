import { describe, expect, it } from 'vitest';
import {
  applyMarkdownLinePrefix,
  getMarkdownHeadingLevel,
  isCursorInsideInlineMarkdown,
  setMarkdownHeading,
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

  it('replaces heading labels and removes them without stacking prefixes', () => {
    const changed = setMarkdownHeading('## A heading', 3, 12, 1);
    expect(changed).toEqual({ content: '# A heading', selectionStart: 2, selectionEnd: 11 });
    expect(setMarkdownHeading(changed.content, 2, 11, 0)).toEqual({ content: 'A heading', selectionStart: 0, selectionEnd: 9 });
    expect(getMarkdownHeadingLevel('## A heading', 8)).toBe(2);
  });

  it('labels all selected lines but leaves the next unselected line intact', () => {
    const result = setMarkdownHeading('First\nSecond\nThird', 0, 13, 3);
    expect(result.content).toBe('### First\n### Second\nThird');
    expect(result.selectionStart).toBe(4);
    expect(result.selectionEnd).toBe(21);
  });

  it('preserves blank lines, indentation, and body text while relabelling', () => {
    expect(setMarkdownHeading('\n  ## First\n\nSecond', 0, 19, 2).content).toBe('\n  ## First\n\n## Second');
    expect(setMarkdownHeading('A\n\nB', 2, 2, 1).content).toBe('A\n# \nB');
    expect(getMarkdownHeadingLevel('\n# Actual heading', 0)).toBe(0);
    expect(getMarkdownHeadingLevel('#### Not a supported label', 8)).toBe(0);
  });

  it('starts a new heading at an empty cursor so the writer can type its label', () => {
    expect(setMarkdownHeading('', 0, 0, 2)).toEqual({ content: '## ', selectionStart: 3, selectionEnd: 3 });
  });

  it('does not treat hashtags inside a paragraph as headings', () => {
    expect(setMarkdownHeading('Words # remain', 5, 5, 2).content).toBe('## Words # remain');
  });
});
