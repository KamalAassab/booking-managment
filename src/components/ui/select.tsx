"use client";

import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "@/components/icons";

export interface SelectOption<T = string | number> {
  value: T;
  label: string;
  group?: string;
  description?: string;
  badge?: string;
}

export interface SelectGroup<T = string | number> {
  category: string;
  items: SelectOption<T>[];
}

export interface SelectDropdownProps<T = string | number> {
  id?: string;
  name?: string;
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectGroup<T>[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
}

export function SelectDropdown<T = string | number>({
  id,
  name,
  value,
  onChange,
  options,
  groups,
  placeholder = "Sélectionner...",
  disabled = false,
  searchable = false,
  searchPlaceholder = "Rechercher...",
  className = "",
}: SelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Determine smart placement on open
  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 230 && spaceAbove > spaceBelow) {
        setPlacement("top");
      } else {
        setPlacement("bottom");
      }
    }
    setIsOpen(!isOpen);
  };

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && searchable) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, searchable]);

  // Flatten options for lookup
  const allOptions: SelectOption<T>[] = React.useMemo(() => {
    if (groups) {
      return groups.flatMap((g) =>
        g.items.map((item) => ({ ...item, group: g.category }))
      );
    }
    return options || [];
  }, [groups, options]);

  const selectedOption = allOptions.find((o) => o.value === value);

  // Filter options by search query
  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return allOptions;
    const q = search.toLowerCase();
    return allOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.group && o.group.toLowerCase().includes(q)) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [allOptions, search]);

  // Group filtered options if groups mode
  const filteredGroups = React.useMemo(() => {
    if (!groups) return null;
    const map = new Map<string, SelectOption<T>[]>();
    for (const opt of filteredOptions) {
      const g = opt.group || "Autres";
      const list = map.get(g) || [];
      list.push(opt);
      map.set(g, list);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, [groups, filteredOptions]);

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div ref={containerRef} className={`relative w-full ${isOpen ? "z-[60]" : "z-10"} ${className}`}>
      {name && <input type="hidden" name={name} value={String(value)} />}

      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={toggleOpen}
        className="field flex items-center justify-between text-left cursor-pointer transition-colors duration-120 select-none"
        style={{
          background: isOpen ? "var(--surface)" : "var(--surface-sunk)",
          borderColor: isOpen ? "var(--accent)" : undefined,
          boxShadow: isOpen ? "0 0 0 3px var(--accent-tint)" : undefined,
        }}
      >
        <span
          className="truncate"
          style={{
            color: selectedOption ? "var(--ink)" : "var(--ink-faint)",
            fontWeight: selectedOption ? 500 : 400,
          }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span
          className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center text-[color:var(--ink-faint)] transition-transform duration-150"
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <ChevronDown size={16} />
        </span>
      </button>

      {/* Floating Popover Menu with Smart Auto-Flip — Top-Layer Stacking */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          className={`card absolute left-0 right-0 z-[70] max-h-[220px] overflow-y-auto overscroll-contain p-1.5 shadow-2xl duration-150 animate-in fade-in ${
            placement === "top"
              ? "bottom-[calc(100%+4px)] slide-in-from-bottom-1"
              : "top-[calc(100%+4px)] slide-in-from-top-1"
          }`}
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
            boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.18), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          }}
        >
          {searchable && (
            <div className="sticky top-0 z-10 mb-1.5 border-b pb-1.5 pt-0.5 px-1 bg-[color:var(--surface)]" style={{ borderColor: "var(--line)" }}>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-2.5 text-[color:var(--ink-faint)]">
                  <Search size={14} />
                </span>
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full rounded-[8px] border py-1.5 pl-8 pr-3 text-[13px] outline-none transition-colors"
                  style={{
                    background: "var(--surface-sunk)",
                    borderColor: "var(--line-strong)",
                    color: "var(--ink)",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setIsOpen(false);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {filteredOptions.length === 0 ? (
            <div className="py-4 text-center text-[13px] font-medium text-[color:var(--ink-faint)]">
              Aucun résultat trouvé.
            </div>
          ) : groups && filteredGroups ? (
            <div className="flex flex-col gap-2">
              {filteredGroups.map((group) => (
                <div key={group.category} className="flex flex-col gap-0.5">
                  <span
                    className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {group.category}
                  </span>
                  {group.items.map((opt) => {
                    const isSelected = opt.value === value;
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelect(opt.value)}
                        className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-[13.5px] transition-colors duration-100 hover:bg-[color:var(--surface-sunk)]"
                        style={{
                          background: isSelected ? "var(--surface-sunk)" : "transparent",
                          color: isSelected ? "var(--ink)" : "var(--ink-soft)",
                          fontWeight: isSelected ? 600 : 500,
                          border: isSelected ? "1px solid var(--accent-tint)" : "1px solid transparent",
                        }}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate">{opt.label}</span>
                          {opt.description && (
                            <span className="text-[11px] text-[color:var(--ink-faint)] truncate">
                              {opt.description}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span className="shrink-0 text-[color:var(--accent)]">
                            <Check size={14} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-[13.5px] transition-colors duration-100 hover:bg-[color:var(--surface-sunk)]"
                    style={{
                      background: isSelected ? "var(--surface-sunk)" : "transparent",
                      color: isSelected ? "var(--ink)" : "var(--ink-soft)",
                      fontWeight: isSelected ? 600 : 500,
                      border: isSelected ? "1px solid var(--accent-tint)" : "1px solid transparent",
                    }}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="truncate">{opt.label}</span>
                      {opt.description && (
                        <span className="text-[11px] text-[color:var(--ink-faint)] truncate">
                          {opt.description}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <span className="shrink-0 text-[color:var(--accent)]">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
