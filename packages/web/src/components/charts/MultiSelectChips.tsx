/**
 * MultiSelectChips — extracted from DataFilterRenderer.tsx (Phase 103).
 *
 * Tag-input multi-select modeled after CoreUI Bootstrap's multi-select:
 * trigger row contains chips + inline search input; popover shows a
 * scrollable checkbox list with a select-all toggle.  Portaled to
 * document.body so it escapes widget-card overflow / react-grid-layout
 * transforms.
 *
 * `formatOption` (optional, default identity) — controls the DISPLAY text
 * for each option/chip while the stored value stays the raw option string.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MultiSelectChipsProps = {
  ariaLabel: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  formatOption?: (opt: string) => string;
};

export function MultiSelectChips({
  ariaLabel,
  options,
  value,
  onChange,
  loading = false,
  formatOption = (o) => o,
}: MultiSelectChipsProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The popover is rendered in a PORTAL to document.body so it escapes the widget
  // card's `overflow: hidden` AND the react-grid-layout transform (which creates a
  // containing block that would otherwise clip even position:fixed). Positioned at
  // the trigger via getBoundingClientRect; recomputed on scroll/resize while open.
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    const measure = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPopoverPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true); // capture: catch scroll in any ancestor
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  // Outside-click closes the popover. Escape closes it too (handled inline on
  // the input's keydown so we don't unnecessarily attach a document listener).
  // NOTE: the popover lives in a portal (NOT inside wrapRef), so the contains-check
  // must also exempt popoverRef — otherwise a click on a checkbox/select-all would
  // be treated as "outside" and close the popover before it registers.
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = wrapRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inTrigger && !inPopover) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filteredOptions = q === ""
    ? options
    : options.filter((o) => o.toLowerCase().includes(q));

  // "Select all options" toggles the VISIBLE (filtered) options. If all visible
  // are already selected → deselects them. Otherwise → unions them in.
  const visibleSelectedCount = filteredOptions.filter((o) => value.includes(o)).length;
  const allVisibleSelected =
    filteredOptions.length > 0 && visibleSelectedCount === filteredOptions.length;
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onChange(value.filter((v) => !filteredOptions.includes(v)));
    } else {
      const toAdd = filteredOptions.filter((o) => !value.includes(o));
      onChange([...value, ...toAdd]);
    }
    inputRef.current?.focus();
  };

  const removeChip = (val: string) => {
    onChange(value.filter((v) => v !== val));
    inputRef.current?.focus();
  };
  const clearAll = () => {
    onChange([]);
    setQuery("");
    inputRef.current?.focus();
  };

  // Click anywhere on the trigger area focuses the input (Coreui convention)
  // EXCEPT when the click landed inside a chip-×, the clear-all ×, or the chevron —
  // those have their own handlers.
  const handleTriggerMouseDown = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest(
        ".datafilter-mschips-action, .datafilter-mschips-chip-x",
      )
    ) {
      return;
    }
    // Prevent the default focus-shift so the input's onFocus fires cleanly
    if (e.target !== inputRef.current) e.preventDefault();
    inputRef.current?.focus();
    setOpen(true);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Backspace on empty input removes the last chip (CoreUI / react-select convention).
    if (e.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" && !open) {
      setOpen(true);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`datafilter-mschips${open ? " is-open" : ""}${focused ? " is-focused" : ""}`}
    >
      {/* Trigger row: chips + inline input + action buttons.
          role="combobox" + aria-* live HERE so screen readers (and tests via
          `findByRole("combobox")`) land on the interactive control. */}
      <div
        ref={triggerRef}
        className="datafilter-mschips-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={handleTriggerMouseDown}
      >
        <div className="datafilter-mschips-chips">
          {value.map((v) => (
            <span key={v} className="datafilter-mschips-chip">
              {formatOption(v)}
              <button
                type="button"
                className="datafilter-mschips-chip-x"
                aria-label={`Remove ${v}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeChip(v);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            className="datafilter-mschips-input"
            value={query}
            placeholder={value.length === 0 ? (loading ? "Loading…" : "") : ""}
            aria-label={`${ariaLabel} search`}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => setFocused(false)}
            // Stop the trigger's onMouseDown from intercepting input focus
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="datafilter-mschips-actions">
          {value.length > 0 && (
            <button
              type="button"
              className="datafilter-mschips-action"
              aria-label="Clear all"
              title="Clear all"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            className="datafilter-mschips-action datafilter-mschips-chevron"
            aria-label={open ? "Close options" : "Open options"}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
          >
            {open ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Popover — portaled to document.body so it is never clipped by the widget
          card's overflow / the react-grid-layout transform. Positioned at the trigger
          via fixed coords (popoverPos); the .datafilter-mschips-popover class still
          supplies the visual styling (the position/left/top/width are overridden inline). */}
      {open && popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            className="datafilter-mschips-popover datafilter-mschips-popover--portal"
            role="listbox"
            style={{
              position: "fixed",
              left: popoverPos.left,
              top: popoverPos.top,
              right: "auto", // neutralize the class's `right: 0` (would stretch to viewport edge)
              width: popoverPos.width,
              maxHeight: `calc(100vh - ${popoverPos.top + 8}px)`,
              overflowY: "auto",
              zIndex: 1000,
            }}
          >
            {filteredOptions.length > 0 && (
              <button
                type="button"
                className="datafilter-mschips-selectall"
                onClick={toggleAllVisible}
                // mousedown-preventDefault keeps focus on the inline input so the
                // operator can keep typing after a select-all click
                onMouseDown={(e) => e.preventDefault()}
              >
                {allVisibleSelected ? "Deselect all options" : "Select all options"}
              </button>
            )}
            <div className="datafilter-mschips-list">
              {filteredOptions.length === 0 ? (
                <div className="datafilter-mschips-empty">
                  {options.length === 0 && loading ? "Loading…" : "No matches"}
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const checked = value.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="datafilter-mschips-row"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`${ariaLabel}: ${opt}`}
                        onChange={(e) => {
                          if (e.target.checked) onChange([...value, opt]);
                          else onChange(value.filter((x) => x !== opt));
                        }}
                      />
                      <span>{formatOption(opt)}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
