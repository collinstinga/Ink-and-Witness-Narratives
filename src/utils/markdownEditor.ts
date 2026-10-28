export interface MarkdownEditResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

export type MarkdownHeadingLevel = 0 | 1 | 2 | 3;

/** Returns the heading label at the cursor, without interpreting text as HTML. */
export function getMarkdownHeadingLevel(content: string, cursor: number): MarkdownHeadingLevel {
  const position = Math.max(0, Math.min(cursor, content.length));
  const lineStart = position === 0 ? 0 : content.lastIndexOf('\n', position - 1) + 1;
  const match = /^ {0,3}(#{1,3})(?:[\t ]+|$)/.exec(content.slice(lineStart));
  return match ? match[1].length as MarkdownHeadingLevel : 0;
}

/** Replaces a line's heading label instead of stacking incompatible Markdown prefixes. */
export function setMarkdownHeading(
  content: string,
  start: number,
  end: number,
  level: MarkdownHeadingLevel
): MarkdownEditResult {
  const selectionStart = Math.max(0, Math.min(start, content.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, content.length));
  const lineStart = selectionStart === 0 ? 0 : content.lastIndexOf('\n', selectionStart - 1) + 1;
  // A selection ending at the next line's start must not change that next line.
  const lastSelectedPosition = selectionEnd > selectionStart && content[selectionEnd - 1] === '\n'
    ? selectionEnd - 1 : selectionEnd;
  const nextBreak = content.indexOf('\n', lastSelectedPosition);
  const lineEnd = nextBreak < 0 ? content.length : nextBreak;
  const lines = content.slice(lineStart, lineEnd).split('\n');
  const transforms: Array<{ oldStart: number; oldLength: number; oldPrefix: number; newStart: number; newPrefix: number; text: string }> = [];
  let oldOffset = lineStart;
  let newOffset = lineStart;
  for (const line of lines) {
    const heading = /^( {0,3})#{1,6}(?:[\t ]+|$)/.exec(line);
    const indentation = heading?.[1] ?? (/^ {0,3}/.exec(line)?.[0] || '');
    const oldPrefix = heading ? heading[0].length : indentation.length;
    const newPrefix = indentation + (level ? `${'#'.repeat(level)} ` : '');
    const formatLine = Boolean(line.trim()) || (selectionStart === selectionEnd && selectionStart >= oldOffset && selectionStart <= oldOffset + line.length);
    const text = formatLine ? newPrefix + line.slice(oldPrefix) : line;
    transforms.push({ oldStart: oldOffset, oldLength: line.length, oldPrefix, newStart: newOffset, newPrefix: formatLine ? newPrefix.length : oldPrefix, text });
    oldOffset += line.length + 1;
    newOffset += text.length + 1;
  }
  const updatedBlock = transforms.map(line => line.text).join('\n');
  const delta = updatedBlock.length - (lineEnd - lineStart);
  const mapPosition = (position: number) => {
    if (position > lineEnd) return position + delta;
    const line = transforms.find(item => position <= item.oldStart + item.oldLength) ?? transforms[transforms.length - 1];
    return line.newStart + Math.max(line.newPrefix, position - line.oldStart + line.newPrefix - line.oldPrefix);
  };
  return {
    content: content.slice(0, lineStart) + updatedBlock + content.slice(lineEnd),
    selectionStart: mapPosition(selectionStart),
    selectionEnd: mapPosition(selectionEnd)
  };
}

function markerPositions(content: string, marker: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (from <= content.length - marker.length) {
    const index = content.indexOf(marker, from);
    if (index < 0) break;
    const escaped = index > 0 && content[index - 1] === '\\';
    if (!escaped) positions.push(index);
    from = index + marker.length;
  }
  return positions;
}

export function isCursorInsideInlineMarkdown(
  content: string,
  cursor: number,
  marker: '**' | '*'
): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, content.length));
  let source = content;
  let adjustedCursor = boundedCursor;
  if (marker === '*') {
    source = '';
    for (let index = 0; index < content.length; index += 1) {
      if (content.slice(index, index + 2) === '**') {
        source += '  ';
        index += 1;
      } else {
        source += content[index];
      }
    }
    adjustedCursor = boundedCursor;
  }
  const positions = markerPositions(source, marker);
  const before = positions.filter(position => position < adjustedCursor).length;
  const hasClosingMarker = positions.some(position => position >= adjustedCursor);
  return before % 2 === 1 && hasClosingMarker;
}

export function toggleInlineMarkdown(
  content: string,
  start: number,
  end: number,
  marker: '**' | '*'
): MarkdownEditResult {
  const selectionStart = Math.max(0, Math.min(start, content.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, content.length));
  const selected = content.slice(selectionStart, selectionEnd);

  if (selected) {
    const wrapped = content.slice(selectionStart - marker.length, selectionStart) === marker
      && content.slice(selectionEnd, selectionEnd + marker.length) === marker;
    if (wrapped) {
      return {
        content: content.slice(0, selectionStart - marker.length)
          + selected
          + content.slice(selectionEnd + marker.length),
        selectionStart: selectionStart - marker.length,
        selectionEnd: selectionEnd - marker.length
      };
    }
    return {
      content: content.slice(0, selectionStart) + marker + selected + marker + content.slice(selectionEnd),
      selectionStart: selectionStart + marker.length,
      selectionEnd: selectionEnd + marker.length
    };
  }

  if (isCursorInsideInlineMarkdown(content, selectionStart, marker)) {
    const closing = content.indexOf(marker, selectionStart);
    const cursor = closing >= 0 ? closing + marker.length : selectionStart;
    return { content, selectionStart: cursor, selectionEnd: cursor };
  }

  return {
    content: content.slice(0, selectionStart) + marker + marker + content.slice(selectionStart),
    selectionStart: selectionStart + marker.length,
    selectionEnd: selectionStart + marker.length
  };
}

export function applyMarkdownLinePrefix(
  content: string,
  start: number,
  end: number,
  prefix: string
): MarkdownEditResult {
  const selectionStart = Math.max(0, Math.min(start, content.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, content.length));
  const lineStart = content.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const nextLineBreak = content.indexOf('\n', selectionEnd);
  const lineEnd = nextLineBreak < 0 ? content.length : nextLineBreak;
  const block = content.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const alreadyPrefixed = lines.every(line => !line.trim() || line.startsWith(prefix));
  const updatedLines = lines.map(line => {
    if (!line.trim()) return line;
    return alreadyPrefixed && line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
  });
  const updatedBlock = updatedLines.join('\n');
  const deltaAtStart = alreadyPrefixed ? -prefix.length : prefix.length;
  const deltaTotal = updatedBlock.length - block.length;
  return {
    content: content.slice(0, lineStart) + updatedBlock + content.slice(lineEnd),
    selectionStart: Math.max(lineStart, selectionStart + deltaAtStart),
    selectionEnd: Math.max(lineStart, selectionEnd + deltaTotal)
  };
}

