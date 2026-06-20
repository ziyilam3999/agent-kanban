// subject-tag.ts — split a leading "[...]" prefix off a ticket subject so the board
// can render it as a distinct chip instead of inline title text.
//
// Why: sub-tasks carry their parent epic as a "[#1063]" prefix in the subject (a plain-text
// task-list convention). On a CARD that already prints the ticket's own id (#1082), that
// prefix double-renders → two #NNNN-looking numbers, ambiguous which is the ticket. We lift
// the prefix into a separate tag the UI styles as a small "↳ #1063" parent chip (or an "EPIC"
// chip), leaving the title clean.

export interface SubjectTag {
  /** The bracket contents (e.g. "#1063", "EPIC"), or null when the subject has no prefix. */
  tag: string | null;
  /** True when the tag is a parent ticket reference like "#1063" (render as "↳ #1063"). */
  isParentRef: boolean;
  /** The subject with the leading "[...]" removed (the original subject when there is none). */
  title: string;
}

/** Parse a single leading "[...]" prefix off a subject. Only the FIRST bracket is lifted;
 *  brackets later in the subject are left untouched (they belong to the title). */
export function parseSubjectTag(subject: string): SubjectTag {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/s.exec(subject);
  if (!m) return { tag: null, isParentRef: false, title: subject };
  const tag = m[1].trim();
  const title = m[2].trim();
  if (!tag || !title) return { tag: null, isParentRef: false, title: subject }; // empty/degenerate → leave as-is
  return { tag, isParentRef: /^#\d+$/.test(tag), title };
}

/** The chip label shown on the card: parent refs get a "↳ " lead so they read as lineage. */
export function subjectTagLabel(t: SubjectTag): string {
  if (!t.tag) return "";
  return t.isParentRef ? `↳ ${t.tag}` : t.tag;
}
