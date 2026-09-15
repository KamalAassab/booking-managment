"use client";

/* eslint-disable @typescript-eslint/no-explicit-any --
   A generic compound component: its parts share one React context, which
   cannot carry a type parameter, so `any` is the default that lets untyped
   JSX usage (`<ComboboxList>{(item) => …}</ComboboxList>`) compile. */

import * as React from "react";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "@/components/icons";

interface ComboboxContextType<T = any> {
  search: string;
  setSearch: (search: string) => void;
  selectedItem: T | null;
  setSelectedItem: (item: T | null) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  items: readonly T[] | T[];
  filteredItems: T[];
  highlightedIndex: number;
  setHighlightedIndex: (index: number) => void;
  selectItem: (item: T) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  listboxId: string;
}

const ComboboxContext = createContext<ComboboxContextType | null>(null);

function useCombobox<T = any>() {
  const context = useContext(ComboboxContext);
  if (!context) {
    throw new Error("Combobox compound components must be used within a <Combobox />");
  }
  return context as ComboboxContextType<T>;
}

export interface ComboboxProps<T = any> {
  items: readonly T[] | T[];
  value?: T | null;
  defaultValue?: T | null;
  onValueChange?: (value: T) => void;
  filter?: (item: T, search: string) => boolean;
  children: React.ReactNode;
  className?: string;
}

export function Combobox<T = any>({
  items,
  value,
  defaultValue = null,
  onValueChange,
  filter,
  children,
  className,
}: ComboboxProps<T>) {
  const [internalValue, setInternalValue] = useState<T | null>(defaultValue);
  const [search, setSearch] = useState<string>("");
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selectedItem = value !== undefined ? value : internalValue;

  const defaultFilter = (item: T, query: string) => {
    if (!query) return true;
    const str = typeof item === "string" ? item : JSON.stringify(item);
    return str.toLowerCase().includes(query.toLowerCase());
  };

  const activeFilter = filter || defaultFilter;
  const filteredItems = React.useMemo(() => {
    return (items as T[]).filter((item) => activeFilter(item, search));
  }, [items, search, activeFilter]);

  const selectItem = (item: T) => {
    if (value === undefined) {
      setInternalValue(item);
    }
    onValueChange?.(item);
    setSearch(typeof item === "string" ? item : "");
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <ComboboxContext.Provider
      value={{
        search,
        setSearch,
        selectedItem,
        setSelectedItem: setInternalValue,
        isOpen,
        setIsOpen,
        items,
        filteredItems,
        highlightedIndex,
        setHighlightedIndex,
        selectItem,
        inputRef,
        listboxId,
      }}
    >
      <div ref={containerRef} className={`relative w-full ${className ?? ""}`}>
        {children}
      </div>
    </ComboboxContext.Provider>
  );
}

export interface ComboboxInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  placeholder?: string;
  showArrow?: boolean;
}

export const ComboboxInput = React.forwardRef<HTMLInputElement, ComboboxInputProps>(
  ({ placeholder = "Select an item...", showArrow = true, className = "", ...props }, forwardedRef) => {
    const {
      search,
      setSearch,
      selectedItem,
      isOpen,
      setIsOpen,
      filteredItems,
      highlightedIndex,
      setHighlightedIndex,
      selectItem,
      inputRef,
      listboxId,
    } = useCombobox();

    React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        setIsOpen(true);
        return;
      }

      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex(
          highlightedIndex < filteredItems.length - 1 ? highlightedIndex + 1 : 0
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex(
          highlightedIndex > 0 ? highlightedIndex - 1 : filteredItems.length - 1
        );
      } else if (e.key === "Enter") {
        if (highlightedIndex >= 0 && highlightedIndex < filteredItems.length) {
          e.preventDefault();
          selectItem(filteredItems[highlightedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    const displayValue = isOpen
      ? search
      : selectedItem
      ? typeof selectedItem === "string"
        ? selectedItem
        : search
      : search;

    return (
      <div className="relative flex items-center w-full">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`field pr-10 ${className}`}
          {...props}
        />
        {showArrow ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setIsOpen(!isOpen)}
            className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-[6px] text-[color:var(--ink-faint)] transition-transform duration-150 hover:text-[color:var(--ink)]"
            style={{
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            <ChevronDown size={16} />
          </button>
        ) : null}
      </div>
    );
  }
);
ComboboxInput.displayName = "ComboboxInput";

export interface ComboboxContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ComboboxContent({ children, className = "" }: ComboboxContentProps) {
  const { isOpen, listboxId } = useCombobox();

  if (!isOpen) return null;

  return (
    <div
      id={listboxId}
      role="listbox"
      className={`card absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[260px] overflow-y-auto p-1.5 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150 ${className}`}
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
      }}
    >
      {children}
    </div>
  );
}

export interface ComboboxEmptyProps {
  children?: React.ReactNode;
  className?: string;
}

export function ComboboxEmpty({
  children = "No items found.",
  className = "",
}: ComboboxEmptyProps) {
  const { filteredItems } = useCombobox();

  if (filteredItems.length > 0) return null;

  return (
    <div
      className={`p-3 text-center text-[13px] font-medium text-[color:var(--ink-faint)] ${className}`}
    >
      {children}
    </div>
  );
}

export interface ComboboxListProps<T = any> {
  children: ((item: T, index: number) => React.ReactNode) | React.ReactNode;
  className?: string;
}

export function ComboboxList<T = any>({ children, className = "" }: ComboboxListProps<T>) {
  const { filteredItems } = useCombobox<T>();

  if (filteredItems.length === 0) return null;

  if (typeof children === "function") {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {filteredItems.map((item, index) => children(item, index))}
      </div>
    );
  }

  return <div className={`flex flex-col gap-1 ${className}`}>{children}</div>;
}

export interface ComboboxItemProps<T = any> {
  value: T;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function ComboboxItem<T = any>({
  value,
  children,
  className = "",
  disabled = false,
}: ComboboxItemProps<T>) {
  const { selectedItem, selectItem, highlightedIndex, filteredItems, setHighlightedIndex } =
    useCombobox<T>();

  const isSelected = selectedItem === value;
  const itemIndex = filteredItems.indexOf(value);
  const isHighlighted = highlightedIndex === itemIndex;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => {
        if (!disabled) selectItem(value);
      }}
      onMouseEnter={() => {
        if (!disabled && itemIndex >= 0) setHighlightedIndex(itemIndex);
      }}
      className={`flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-[13.5px] transition-colors duration-100 ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${className}`}
      style={{
        background: isHighlighted || isSelected ? "var(--surface-sunk)" : "transparent",
        color: isSelected ? "var(--ink)" : "var(--ink-soft)",
        fontWeight: isSelected ? 600 : 500,
        border: isHighlighted ? "1px solid var(--accent-tint)" : "1px solid transparent",
      }}
    >
      <span className="truncate">{children}</span>
      {isSelected ? (
        <span className="shrink-0 ml-2 text-[color:var(--accent)]">
          <Check size={14} />
        </span>
      ) : null}
    </button>
  );
}
