'use client';

import * as React from 'react';
import { motion, isMotionComponent, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/lib/utils';

type AnyProps = Record<string, unknown>;

type DOMMotionProps<T extends HTMLElement = HTMLElement> = Omit<
  HTMLMotionProps<keyof HTMLElementTagNameMap>,
  'ref'
> & { ref?: React.Ref<T> };

type WithAsChild<Base extends object> =
  | (Base & { asChild: true; children: React.ReactElement })
  | (Base & { asChild?: false | undefined });

type SlotProps<T extends HTMLElement = HTMLElement> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any;
} & DOMMotionProps<T>;

// `motion.create()` returns a new component type on every call, and calling
// it inline during render — even memoized per-instance with `useMemo` — is
// still "creating a component during render" as far as the rule (and
// remounting risk if `useMemo`'s deps ever miss a change) is concerned. This
// module-level cache creates each wrapped motion component exactly once per
// underlying element type, shared across every `Slot` instance and render.
// A plain `Map` rather than `WeakMap` because `React.ElementType` includes
// string tag names ("div", "span" …), which cannot be `WeakMap` keys; the set
// of distinct element types rendered through `Slot` is small and static, so
// this carries no meaningful memory cost.
const motionComponentCache = new Map<React.ElementType, React.ElementType>();

function getMotionComponent(type: React.ElementType): React.ElementType {
  let cached = motionComponentCache.get(type);
  if (!cached) {
    cached = motion.create(type);
    motionComponentCache.set(type, cached);
  }
  return cached;
}

function mergeRefs<T>(
  ...refs: (React.Ref<T> | undefined)[]
): React.RefCallback<T> {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.RefObject<T | null>).current = node;
      }
    });
  };
}

function mergeProps<T extends HTMLElement>(
  childProps: AnyProps,
  slotProps: DOMMotionProps<T>,
): AnyProps {
  const merged: AnyProps = { ...childProps, ...slotProps };

  if (childProps.className || slotProps.className) {
    merged.className = cn(
      childProps.className as string,
      slotProps.className as string,
    );
  }

  if (childProps.style || slotProps.style) {
    merged.style = {
      ...(childProps.style as React.CSSProperties),
      ...(slotProps.style as React.CSSProperties),
    };
  }

  return merged;
}

function Slot<T extends HTMLElement = HTMLElement>({
  children,
  ref,
  ...props
}: SlotProps<T>) {
  const isAlreadyMotion =
    typeof children.type === 'object' &&
    children.type !== null &&
    isMotionComponent(children.type);

  const Base = isAlreadyMotion
    ? (children.type as React.ElementType)
    : getMotionComponent(children.type as React.ElementType);

  if (!React.isValidElement(children)) return null;

  const { ref: childRef, ...childProps } = children.props as AnyProps;

  const mergedProps = mergeProps(childProps, props);

  // `Base` is a polymorphic tag, not a component "created during render" in
  // the sense this rule targets: `getMotionComponent()` returns a cached,
  // stable identity per element type (see above), so the same `children.type`
  // always resolves to the same `Base` across renders and instances — the
  // lint rule can't verify that statically for a dynamically-chosen JSX tag,
  // which is the same shape as Radix UI's `Slot` primitive this is modelled on.
  return (
    // eslint-disable-next-line react-hooks/static-components
    <Base {...mergedProps} ref={mergeRefs(childRef as React.Ref<T>, ref)} />
  );
}

export {
  Slot,
  type SlotProps,
  type WithAsChild,
  type DOMMotionProps,
  type AnyProps,
};
