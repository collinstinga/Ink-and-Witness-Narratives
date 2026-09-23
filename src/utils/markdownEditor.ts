export interface MarkdownEditResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
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

