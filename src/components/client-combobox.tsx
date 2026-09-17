"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { searchClientsAction } from "@/app/actions/clients";
import type { ClientSuggestion } from "@/lib/clients";

type Props = {
  value: string;
  onChange: (name: string) => void;
  onSelectClient: (client: { name: string; phone: string; services?: string[] }) => void;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  required?: boolean;
};

/** Short enough to feel immediate, long enough not to query every keystroke. */
const SEARCH_DEBOUNCE_MS = 120;

/**
 * The client name field, suggesting clients already on file as the agent
 * types, so a returning client's phone number is one pick away.
 *
 * Suggestions follow typing only. A name that arrives any other way (an
 * existing booking opened for editing, a suggestion just picked) is not a
 * question: searching on it opened a list over the form the moment the
 * sheet appeared, and again right after a client had been chosen.
 */
export function ClientCombobox({
  value,
  onChange,
  onSelectClient,
  disabled,
  inputRef,
  required = true,
}: Props) {
  const [suggestions, setSuggestions] = useState<ClientSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPending, startTransition] = useTransition();
  const listboxId = useId();

  const containerRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const activeInputRef = inputRef || internalInputRef;
  /** True once the current value came from the keyboard. */
  const typedRef = useRef(false);

  // Each search is numbered so a slow answer for "Sa" cannot land after, and
  // replace, the answer for "Sarah".
  const latestSearch = useRef(0);
  useEffect(() => {
    const term = value.trim();
    const search = ++latestSearch.current;
    if (!typedRef.current || term.length < 1) return;

    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await searchClientsAction(term);
          if (search !== latestSearch.current || !typedRef.current) return;
          setSuggestions(results);
          setActiveIndex(-1);
          if (results.length > 0 && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const below = window.innerHeight - rect.bottom;
            setPlacement(below < 260 && rect.top > below ? "top" : "bottom");
          }
          setIsOpen(results.length > 0);
        } catch {
          if (search !== latestSearch.current) return;
          setSuggestions([]);
          setIsOpen(false);
        }
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value]);

  // An emptied field has nothing to suggest, whatever the last search found.
  const showSuggestions = isOpen && value.trim().length > 0 && suggestions.length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(item: ClientSuggestion) {
    typedRef.current = false;
    onChange(item.name);
    onSelectClient({ name: item.name, phone: item.phone, services: item.lastServices });
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      // Marked as handled, so the booking sheet around this field closes the
      // suggestions only, not the booking being typed.
      e.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${showSuggestions ? "z-[var(--z-popover)]" : ""}`}
      style={{ zIndex: showSuggestions ? 90 : undefined }}
    >
      <div className="relative flex items-center">
        <input
          ref={activeInputRef}
          type="text"
          id="client_name"
          name="client_name"
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={value}
          onChange={(e) => {
            typedRef.current = true;
            onChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (typedRef.current && suggestions.length > 0) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder="Nom et prénom"
          className="field pr-9"
        />
        {isPending ? (
          <span
            className="pointer-events-none absolute right-3 h-4 w-4 animate-spin rounded-full border-2"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            aria-hidden
          />
        ) : null}
      </div>

      {showSuggestions ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Clients existants"
          className={`popover absolute left-0 right-0 z-[100] shadow-2xl max-h-[260px] overflow-y-auto overscroll-contain p-1.5 ${
            placement === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
          style={{ zIndex: 100 }}
        >
          <p className="flex items-center justify-between px-2.5 pb-1 pt-0.5 text-[12px] font-medium" style={{ color: "var(--ink-faint)" }}>
            <span>Clients existants</span>
            <span data-nums>{suggestions.length}</span>
          </p>
          {suggestions.map((item, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={`${item.phone}-${item.name}`}
                id={`${listboxId}-${idx}`}
                type="button"
                role="option"
                aria-selected={active}
                data-active={active ? "" : undefined}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(idx)}
                className="option"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                    {item.name}
                  </span>
                  <span className="truncate text-[12.5px]" style={{ color: "var(--ink-soft)" }} data-nums>
                    {item.formattedPhone}
                    {item.lastService ? ` · ${item.lastService}` : ""}
                  </span>
                </span>
                <span className="chip shrink-0" data-nums>
                  {item.totalBookings} rdv
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
