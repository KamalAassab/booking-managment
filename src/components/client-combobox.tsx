"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { searchClientsAction } from "@/app/actions/clients";
import { Check, Phone, Search, User } from "@/components/icons";
import type { ClientSuggestion } from "@/lib/clients";

type Props = {
  value: string;
  onChange: (name: string) => void;
  onSelectClient: (client: { name: string; phone: string; service?: string }) => void;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  required?: boolean;
};

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
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [isPending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const activeInputRef = inputRef || internalInputRef;

  // Compute smart placement
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 230 && spaceAbove > spaceBelow) {
        setPlacement("top");
      } else {
        setPlacement("bottom");
      }
    }
  }, [isOpen]);

  // Debounced search when value changes
  useEffect(() => {
    const term = value.trim();
    if (term.length < 1) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await searchClientsAction(term);
          setSuggestions(results);
          if (results.length > 0) {
            setIsOpen(true);
            setSelectedIndex(-1);
          } else {
            setIsOpen(false);
          }
        } catch {
          setSuggestions([]);
          setIsOpen(false);
        }
      });
    }, 150);

    return () => clearTimeout(timer);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(item: ClientSuggestion) {
    onChange(item.name);
    onSelectClient({
      name: item.name,
      phone: item.phone,
      service: item.lastService,
    });
    setIsOpen(false);
    setSelectedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  const datalistId = "clients-autocomplete-datalist";

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={activeInputRef}
          type="text"
          id="client_name"
          name="client_name"
          required={required}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          disabled={disabled}
          placeholder="Ex. Sarah Benali"
          className="field pr-8"
        />
        {isPending ? (
          <span
            className="pointer-events-none absolute right-2.5 flex h-4 w-4 animate-spin items-center justify-center rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
          />
        ) : null}
      </div>

      {/* Mobile Native Datalist (Standard mobile phone autocomplete mechanism) */}
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option
            key={`dl-${s.phone}-${s.name}`}
            value={s.name}
            label={`${s.formattedPhone} (${s.totalBookings} rdv)`}
          />
        ))}
      </datalist>

      {/* Desktop Premium Dropdown Popover */}
      {isOpen && suggestions.length > 0 && (
        <div
          className={`card absolute left-0 right-0 z-50 hidden max-h-[220px] overflow-y-auto overscroll-contain p-1.5 shadow-xl sm:block duration-150 animate-in fade-in ${
            placement === "top"
              ? "bottom-[calc(100%+4px)] slide-in-from-bottom-1"
              : "top-[calc(100%+4px)] slide-in-from-top-1"
          }`}
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
            boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.18), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          }}
          role="listbox"
        >
          <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
            <span>Clients existants</span>
            <span>{suggestions.length} trouvé{suggestions.length > 1 ? "s" : ""}</span>
          </div>

          <div className="mt-1 flex flex-col gap-1">
            {suggestions.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={`${item.phone}-${item.name}`}
                  type="button"
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left transition-colors duration-100"
                  style={{
                    background: isSelected ? "var(--surface-sunk)" : "transparent",
                    color: "var(--ink)",
                    border: isSelected ? "1px solid var(--accent-tint)" : "1px solid transparent",
                  }}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                        {item.name}
                      </span>
                      <span
                        className="t-small shrink-0 rounded-full px-1.5 py-0.2 text-[10px] font-medium"
                        style={{
                          background: "var(--accent-tint)",
                          color: "var(--accent-hover)",
                        }}
                      >
                        {item.totalBookings} rdv
                      </span>
                    </div>
                    <span className="t-small mt-0.5 truncate text-[11px]" style={{ color: "var(--ink-soft)" }}>
                      {item.formattedPhone} {item.lastService ? `• ${item.lastService}` : ""}
                    </span>
                  </div>

                  <span
                    className="t-small flex shrink-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-opacity"
                    style={{
                      background: isSelected ? "var(--surface)" : "var(--surface-sunk)",
                      color: isSelected ? "var(--accent)" : "var(--ink-faint)",
                    }}
                  >
                    Choisir
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
