"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

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

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * A select with a styled list, optional search and groups.
 *
 * Keyboard first, because the call centre types: Enter, Space or ArrowDown
 * opens it; typing filters (accents ignored, "epil" finds "Épilation");
 * arrows move; Enter picks; Escape closes without closing the sheet around
 * it. The list opens above the field when there is no room below.
 */
export function SelectDropdown<T = string | number>({
  id,
  name,
  value,
  onChange,
  options,
  groups,
  placeholder = "Sélectionner",
  disabled = false,
  searchable = false,
  searchPlaceholder = "Rechercher",
  className = "",
}: SelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const allOptions: SelectOption<T>[] = useMemo(() => {
    if (groups) return groups.flatMap((g) => g.items.map((item) => ({ ...item, group: g.category })));
    return options || [];
  }, [groups, options]);

  const selectedOption = allOptions.find((o) => o.value === value);

  const filteredOptions = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return allOptions;
    return allOptions.filter(
      (o) =>
        normalize(o.label).includes(q) ||
        (o.group !== undefined && normalize(o.group).includes(q)) ||
        (o.description !== undefined && normalize(o.description).includes(q)),
    );
  }, [allOptions, search]);

  function open() {
    if (disabled) return;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setPlacement(below < 300 && rect.top > below ? "top" : "bottom");
    }
    setActiveIndex(Math.max(0, allOptions.findIndex((o) => o.value === value)));
    setIsOpen(true);
  }

  function close({ refocus = false } = {}) {
    setIsOpen(false);
    setSearch("");
    if (refocus) triggerRef.current?.focus();
  }

  function pick(option: SelectOption<T>) {
    onChange(option.value);
    close({ refocus: true });
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Straight into the search box: the list and the box render together.
  useEffect(() => {
    if (!isOpen) return;
    if (searchable) searchInputRef.current?.focus();
    else listRef.current?.focus();
  }, [isOpen, searchable]);

  // Keep the active option in view as the arrows move it.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [isOpen, activeIndex, listboxId]);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // Marked as handled, so a dialog around this dropdown stays open.
      e.preventDefault();
      close({ refocus: true });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filteredOptions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home" && !searchable) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && !searchable) {
      e.preventDefault();
      setActiveIndex(filteredOptions.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) pick(option);
    } else if (e.key === "Tab") {
      close();
    }
  }

  const renderOption = (opt: SelectOption<T>, index: number) => {
    const isSelected = opt.value === value;
    return (
      <button
        key={String(opt.value)}
        id={`${listboxId}-${index}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        data-active={index === activeIndex ? "" : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => setActiveIndex(index)}
        onClick={() => pick(opt)}
        className="option"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate" style={{ fontWeight: isSelected ? 600 : 500, color: "var(--ink)" }}>
            {opt.label}
          </span>
          {opt.description ? (
            <span className="truncate text-[12.5px]" style={{ color: "var(--ink-faint)" }} data-nums>
              {opt.description}
            </span>
          ) : null}
        </span>
        {isSelected ? (
          <span className="shrink-0" style={{ color: "var(--accent-ink)" }}>
            <Check size={16} />
          </span>
        ) : null}
      </button>
    );
  };

  // Indices run over the filtered list in display order, grouped or not.
  let running = 0;

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${isOpen ? "z-[var(--z-popover)]" : ""} ${className}`}
    >
      {name ? <input type="hidden" name={name} value={String(value)} /> : null}

      {/* Phone: the platform's own picker — a wheel or sheet the agent
          already knows, and one that a touch keyboard never fights with.
          The styled listbox below is a desktop-only affordance; small
          screens get the OS control instead of a second, imitation one. */}
      <select
        value={String(value)}
        onChange={(e) => {
          const match = allOptions.find((o) => String(o.value) === e.target.value);
          if (match) onChange(match.value);
        }}
        disabled={disabled}
        aria-label={placeholder}
        className="field md:hidden"
      >
        {!selectedOption ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {groups
          ? groups.map((group) => (
              <optgroup key={group.category} label={group.category}>
                {group.items.map((opt) => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))
          : allOptions.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
      </select>

      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={(e) => {
          if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            open();
          }
        }}
        className="field hidden items-center justify-between gap-2 text-left md:flex"
        data-open={isOpen ? "" : undefined}
      >
        <span
          className="truncate"
          style={{ color: selectedOption ? "var(--ink)" : "var(--ink-faint)", fontWeight: selectedOption ? 500 : 400 }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span
          className="flex shrink-0"
          style={{ color: "var(--ink-soft)", transform: isOpen ? "rotate(180deg)" : undefined }}
        >
          <ChevronDown size={16} />
        </span>
      </button>

      {isOpen ? (
        <div
          className={`popover absolute left-0 right-0 flex max-h-[min(360px,60dvh)] flex-col overflow-hidden ${
            placement === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
          onKeyDown={onListKeyDown}
        >
          {searchable ? (
            <div className="border-b p-1.5" style={{ borderColor: "var(--line)" }}>
              <div className="relative flex items-center">
                <span className="pointer-events-none absolute left-3" style={{ color: "var(--ink-faint)" }}>
                  <Search size={15} />
                </span>
                <input
                  ref={searchInputRef}
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listboxId}
                  aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
                  autoComplete="off"
                  className="field min-h-[40px] py-2 pl-9"
                />
              </div>
            </div>
          ) : null}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={searchable ? undefined : -1}
            aria-activedescendant={!searchable && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13.5px]" style={{ color: "var(--ink-faint)" }}>
                Aucun résultat.
              </p>
            ) : groups ? (
              Array.from(
                filteredOptions.reduce((map, opt) => {
                  const key = opt.group ?? "Autres";
                  map.set(key, [...(map.get(key) ?? []), opt]);
                  return map;
                }, new Map<string, SelectOption<T>[]>()),
              ).map(([category, items]) => (
                <div key={category} role="group" aria-label={category} className="pb-1">
                  <p className="px-3 pb-1 pt-2 text-[12px] font-semibold" style={{ color: "var(--ink-soft)" }}>
                    {category}
                  </p>
                  {items.map((opt) => renderOption(opt, running++))}
                </div>
              ))
            ) : (
              filteredOptions.map((opt) => renderOption(opt, running++))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
