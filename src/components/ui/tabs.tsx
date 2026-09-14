/**
 * Minimal Tabs primitive built on @radix-ui/react-tabs.
 * Styled to match the project's warm-cream design system.
 */
"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import { forwardRef } from "react";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={className}
    style={{
      display: "inline-flex",
      gap: 2,
      padding: 3,
      borderRadius: "var(--radius-xl)",
      background: "var(--surface-sunk)",
      border: "1px solid var(--line)",
    }}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger> & {
    color?: string;
  }
>(({ className, color, style, children, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={className}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      minHeight: 36,
      padding: "0 16px",
      borderRadius: "var(--radius-lg)",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      transition: "background 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out",
      border: "none",
      background: "transparent",
      color: "var(--ink-soft)",
      ...style,
    }}
    data-color={color}
    {...props}
  >
    {color && (
      <span
        style={{
          display: "block",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
        aria-hidden
      />
    )}
    {children}
    <style>{`
      [data-state="active"][data-color] {
        background: var(--surface) !important;
        box-shadow: var(--shadow-card) !important;
        color: var(--ink) !important;
        font-weight: 600 !important;
      }
      [data-radix-tabs-trigger][data-state="active"]:not([data-color]) {
        background: var(--surface) !important;
        box-shadow: var(--shadow-card) !important;
        color: var(--ink) !important;
        font-weight: 600 !important;
      }
    `}</style>
  </RadixTabs.Trigger>
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ ...props }, ref) => <RadixTabs.Content ref={ref} {...props} />);
TabsContent.displayName = "TabsContent";
