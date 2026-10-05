/**
 * Trusted React component overrides for named UI slots.
 *
 * Sandboxed Worker extensions cannot ship React. Host code, bundled
 * extensions, or in-process plugins call `registerUiComponent` to replace
 * `shell`, `button`, etc. Lookups go through `resolveUiComponent` /
 * `useUiComponent`, which the shared primitives consult so overrides apply
 * everywhere.
 */

"use client";

import React, { useSyncExternalStore, type ComponentType } from "react";
import type { UiSlotId } from "./ui-slots";

type AnyComponent = ComponentType<any>;

const registry = new Map<string, AnyComponent>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** Register (or replace) the React component for a slot / componentKey. */
export function registerUiComponent(slotOrKey: UiSlotId | string, component: AnyComponent): () => void {
  registry.set(slotOrKey, component);
  emit();
  return () => {
    if (registry.get(slotOrKey) === component) {
      registry.delete(slotOrKey);
      emit();
    }
  };
}

export function unregisterUiComponent(slotOrKey: UiSlotId | string): void {
  if (registry.delete(slotOrKey)) emit();
}

export function peekUiComponent<T extends AnyComponent = AnyComponent>(
  slotOrKey: UiSlotId | string,
): T | undefined {
  return registry.get(slotOrKey) as T | undefined;
}

/**
 * Resolve a slot: tries `preferredKey`, then the bare slot id.
 * Returns `fallback` when nothing is registered.
 */
export function resolveUiComponent<T extends AnyComponent>(
  slot: UiSlotId | string,
  fallback: T,
  preferredKey?: string | null,
): T {
  if (preferredKey) {
    const preferred = registry.get(preferredKey);
    if (preferred) return preferred as T;
  }
  const registered = registry.get(slot);
  return (registered as T | undefined) ?? fallback;
}

export function listRegisteredUiComponents(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Subscribe to registry changes (for shells / wrappers that need re-render). */
export function useUiComponent<T extends AnyComponent>(
  slot: UiSlotId | string,
  fallback: T,
  preferredKey?: string | null,
): T {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return resolveUiComponent(slot, fallback, preferredKey);
}

/**
 * Render the registered component for a slot, or `fallback`.
 * Prefer this over calling `useUiComponent` when the fallback itself is heavy.
 */
export function UiSlot<P extends object>({
  slot,
  fallback: Fallback,
  preferredKey,
  ...props
}: {
  slot: UiSlotId | string;
  fallback: ComponentType<P>;
  preferredKey?: string | null;
} & P): React.ReactElement {
  const Comp = useUiComponent(slot, Fallback, preferredKey);
  return <Comp {...(props as P)} />;
}
