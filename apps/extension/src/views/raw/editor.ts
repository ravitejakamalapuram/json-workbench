// The CodeMirror 6 editor of Raw: JSON highlighting, search, undo, the error
// marks and the few commands the view needs. Colors and metrics live in
// raw.css, in Lumen tokens; CodeMirror's own theme is overridden there.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { LIMITS, type ParseIssue } from "../../platform/types";
import type { Change } from "./fixes";

const readOnlyMode = new Compartment();

/** A change that did not come from the user (the document loaded or was converted), so it is not saved back. */
const external = Annotation.define<boolean>();

type Range = { readonly from: number; readonly to: number };
const setError = StateEffect.define<Range | null>();

class ErrorNumber extends GutterMarker {
  override elementClass = "raw-error-number";
}
const errorNumber = new ErrorNumber();
const errorLine = Decoration.line({ class: "raw-error-line" });
const errorToken = Decoration.mark({ class: "raw-error-token" });

/**
 * The error: its token underlined, its line tinted and its line number
 * colored (never color alone: the underline is wavy). The range follows the
 * text while the user edits, until the next parse replaces it.
 */
const errorMarks = StateField.define<Range | null>({
  create: () => null,
  update(range, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setError)) return effect.value;
    if (!range || !transaction.docChanged) return range;
    const from = transaction.changes.mapPos(range.from, 1);
    const to = transaction.changes.mapPos(range.to, -1);
    return { from, to: Math.max(from, to) };
  },
  provide: (field) => [
    EditorView.decorations.compute([field], (state) => {
      const range = state.field(field);
      if (!range) return Decoration.none;
      const line = errorLine.range(state.doc.lineAt(range.from).from);
      return Decoration.set(
        range.to > range.from
          ? [line, errorToken.range(range.from, range.to)]
          : [line],
        true,
      );
    }),
    gutterLineClass.compute([field], (state) => {
      const range = state.field(field);
      return range
        ? RangeSet.of([errorNumber.range(state.doc.lineAt(range.from).from)])
        : RangeSet.empty;
    }),
  ],
});

/** The token the issue points at: a string, a word or one punctuation mark; at the end of a line, its last character. */
function tokenAt(doc: Text, issue: ParseIssue): Range {
  const line = doc.line(Math.min(Math.max(issue.line, 1), doc.lines));
  const at = line.from + Math.min(issue.column - 1, line.length);
  const token =
    /^(?:"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s{}[\],:"'/]+|\S)/.exec(
      line.text.slice(at - line.from),
    );
  return token
    ? { from: at, to: at + token[0].length }
    : { from: Math.max(line.from, at - 1), to: at };
}

export function markError(view: EditorView, issue: ParseIssue | null) {
  view.dispatch({
    effects: setError.of(issue && tokenAt(view.state.doc, issue)),
  });
}

/** Three lines of raw.css's 28 px rows. */
const CONTEXT = 84;

export function goToError(view: EditorView, issue: ParseIssue) {
  const anchor = tokenAt(view.state.doc, issue).from;
  view.dispatch({
    selection: { anchor },
    // The plain scroll stops at the nearest edge, which draws the error on
    // the last visible row with its underline cut off.
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
  });
  view.focus();
}

export function applyChanges(view: EditorView, changes: readonly Change[]) {
  const [first] = changes;
  // Where the first change ends once it is in.
  const anchor = first && first.from + first.insert.length;
  view.dispatch({
    changes: [...changes],
    ...(anchor !== undefined && {
      selection: { anchor },
      // A fix in view does not scroll; one out of view lands with context.
      effects: EditorView.scrollIntoView(anchor, {
        y: "nearest",
        yMargin: CONTEXT,
      }),
    }),
    userEvent: "input.fix",
  });
  view.focus();
}

/** Replaces the whole text. `fromUser` is false for text that came from the document, which is not an edit to save. */
export function replaceText(view: EditorView, text: string, fromUser: boolean) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    ...(!fromUser && {
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    }),
    userEvent: fromUser ? "input.format" : "set",
  });
}

export function setReadOnly(view: EditorView, readOnly: boolean) {
  view.dispatch({
    effects: readOnlyMode.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}

export type EditorOptions = {
  readonly text: string;
  /** The user changed the text. */
  readonly onEdit: () => void;
  /** The editor lost focus. */
  readonly onBlur: () => void;
  readonly onCursor: (line: number, column: number) => void;
  /** A change was refused because the text would pass LIMITS.rawEditChars. */
  readonly onRefused: () => void;
};

export function createEditor(
  parent: HTMLElement,
  { text, onEdit, onBlur, onCursor, onRefused }: EditorOptions,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        json(),
        syntaxHighlighting(classHighlighter),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        errorMarks,
        readOnlyMode.of(EditorState.readOnly.of(false)),
        EditorView.contentAttributes.of({ "aria-label": "JSON text" }),
        EditorView.domEventHandlers({
          // A dropped file opens as a document through the shell's drop zone,
          // which hears the event bubble; CodeMirror would insert its text.
          // Text dragged inside the editor still moves.
          drop: (event) => event.dataTransfer?.types.includes("Files") === true,
          blur: () => {
            onBlur();
            return false;
          },
        }),
        // The doc engine takes no more, so the editor does not either.
        EditorState.changeFilter.of((transaction) => {
          if (transaction.newDoc.length <= LIMITS.rawEditChars) return true;
          onRefused();
          return false;
        }),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(external))
          )
            onEdit();
          if (update.docChanged || update.selectionSet) {
            const { head } = update.state.selection.main;
            const line = update.state.doc.lineAt(head);
            onCursor(line.number, head - line.from + 1);
          }
        }),
      ],
    }),
  });
}
