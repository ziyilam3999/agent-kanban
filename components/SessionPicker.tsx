"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionSummary } from "@/lib/board-schema";

interface SessionPickerProps {
  sessions: SessionSummary[];
  /** Currently-selected session id (from ?session= or the board default). */
  selectedId: string;
}

/**
 * Dropdown over the board's sessions. Selecting one writes ?session=<id> to the
 * URL (the loader can ignore it for now — this wires the control + URL state).
 */
export function SessionPicker({ sessions, selectedId }: SessionPickerProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // selectedId may be the full session uuid (board default) or an 8-char id
  // (?session= param) — match exact OR prefix so both resolve to the right row.
  const current =
    sessions.find((s) => s.id === selectedId || selectedId.startsWith(s.id)) ??
    sessions[0] ??
    null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("session", id);
    router.replace(`?${next.toString()}`, { scroll: false });
    setOpen(false);
  }

  if (!current) return null;

  return (
    <div className="ak-picker" ref={rootRef}>
      <button
        type="button"
        className="ak-picker__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current.live && <span className="ak-picker__live" aria-hidden />}
        <span className="ak-picker__label">{current.label}</span>
        <span className="ak-picker__caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="ak-picker__menu" role="listbox" aria-label="sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === current.id}
              className="ak-picker__opt"
              onClick={() => select(s.id)}
            >
              <span
                className={`ak-picker__opt-dot${
                  s.live ? " ak-picker__opt-dot--live" : ""
                }`}
                aria-hidden
              />
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
