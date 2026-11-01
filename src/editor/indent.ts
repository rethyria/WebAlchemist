/**
 * What pressing Tab or Shift+Tab does to the text in the editor.
 *
 * The result is a replacement of one range of the text, not a whole new value,
 * so the caller can apply it through the browser's own editing command and
 * keep the textarea's undo history. Assigning a new value from script clears
 * that history in Firefox (this was not measured in a browser).
 */

const INDENT = "  ";

export interface IndentEdit {
  /** The range of the current text to replace. */
  from: number;
  to: number;
  text: string;
  /** Where the selection goes once the replacement is made. */
  selectionStart: number;
  selectionEnd: number;
}

export function indentEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent: boolean,
): IndentEdit {
  const spansLines = value.slice(selectionStart, selectionEnd).includes("\n");

  if (!spansLines && !outdent) {
    // One line, or none: the selection is replaced, as in any text field.
    return {
      from: selectionStart,
      to: selectionEnd,
      text: INDENT,
      selectionStart: selectionStart + INDENT.length,
      selectionEnd: selectionStart + INDENT.length,
    };
  }

  // A selection that ends at the start of a line does not include that line.
  const lastChar =
    selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? 1 : 0;
  const from = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionEnd - lastChar);
  const to = lineEnd === -1 ? value.length : lineEnd;

  const lines = value.slice(from, to).split("\n");
  let offset = from;
  let start = selectionStart;
  let end = selectionEnd;
  const changed = lines.map((line, index) => {
    const lineStart = offset;
    offset += line.length + 1;
    let delta: number;
    let next: string;
    if (outdent) {
      const removed = line.startsWith(INDENT)
        ? INDENT.length
        : line.startsWith(" ") || line.startsWith("\t")
          ? 1
          : 0;
      next = line.slice(removed);
      delta = -removed;
    } else if (line === "") {
      // Empty lines stay empty rather than gaining trailing spaces.
      next = line;
      delta = 0;
    } else {
      next = INDENT + line;
      delta = INDENT.length;
    }
    // A position inside the removed characters moves to the start of the line.
    if (index === 0) start += Math.max(delta, lineStart - selectionStart);
    if (
      selectionEnd > lineStart ||
      (index === 0 && selectionEnd === lineStart)
    ) {
      end += Math.max(delta, lineStart - selectionEnd);
    }
    return next;
  });

  return {
    from,
    to,
    text: changed.join("\n"),
    selectionStart: start,
    selectionEnd: end,
  };
}
