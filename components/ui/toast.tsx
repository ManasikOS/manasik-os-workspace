"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TONE_TEXT } from "@/lib/ui/tone";
import {
  XIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const toast = ToastPrimitive.createToastManager();

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed inset-x-4 bottom-4 z-70 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-top-right rounded-md bg-card/80! backdrop-blur-lg text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null;

  if (type === "success") {
    icon = <CircleCheckIcon className={TONE_TEXT.success} aria-hidden="true" />;
  }

  if (type === "info") {
    icon = <InfoIcon className={TONE_TEXT.info} aria-hidden="true" />;
  }

  if (type === "warning") {
    icon = <TriangleAlertIcon className={TONE_TEXT.warning} aria-hidden="true" />;
  }

  if (type === "error") {
    icon = <OctagonXIcon className={TONE_TEXT.danger} aria-hidden="true" />;
  }

  if (type === "loading") {
    icon = <Loader2Icon className="animate-spin text-muted-foreground" aria-hidden="true" />;
  }

  if (!icon) {
    return null;
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ));
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

interface RunWithLoadingToastOptions<TaskResult> {
  /** Shown immediately, with a spinner, while the task is running. */
  loadingTitle: string;
  loadingDescription?: string;
  /** Shown when the task finishes without failing. */
  successTitle: string;
  successDescription?: string;
  /** Title of the error toast, used when the task fails or throws. */
  errorTitle: string;
  /**
   * For server actions that report failure in their return value (e.g.
   * `{ ok: false, error }`) instead of throwing: return the failure message
   * to show the error toast, or `undefined` when the task succeeded.
   */
  getFailureMessage?: (result: TaskResult) => string | undefined;
  /**
   * Return true when the outcome is handled elsewhere (e.g. it opens a
   * follow-up dialog) so the loading toast should just disappear.
   */
  shouldDismissSilently?: (result: TaskResult) => boolean;
}

const LOADING_TOAST_RESULT_VISIBLE_MS = 5000;

/**
 * Shows a toast with a spinner the moment a slow task starts, then turns
 * that same toast into a success or error toast when the task settles — so
 * the user gets instant feedback instead of a silent wait.
 *
 * Resolves with the task's result, or `undefined` if the task threw (the
 * error is already shown to the user, so callers need no extra try/catch).
 */
async function runWithLoadingToast<TaskResult>(
  task: () => Promise<TaskResult>,
  options: RunWithLoadingToastOptions<TaskResult>,
): Promise<TaskResult | undefined> {
  const loadingToastId = toast.add({
    type: "loading",
    title: options.loadingTitle,
    description: options.loadingDescription,
    // 0 = never auto-dismiss while the task is still running.
    timeout: 0,
  });

  const showFailure = (message: string | undefined) =>
    toast.update(loadingToastId, {
      type: "error",
      title: options.errorTitle,
      description: message,
      timeout: LOADING_TOAST_RESULT_VISIBLE_MS,
    });

  try {
    const result = await task();

    if (options.shouldDismissSilently?.(result)) {
      toast.close(loadingToastId);
      return result;
    }

    const failureMessage = options.getFailureMessage?.(result);

    if (failureMessage !== undefined) {
      showFailure(failureMessage);
    } else {
      toast.update(loadingToastId, {
        type: "success",
        title: options.successTitle,
        description: options.successDescription,
        timeout: LOADING_TOAST_RESULT_VISIBLE_MS,
      });
    }
    return result;
  } catch (error) {
    showFailure(
      error instanceof Error ? error.message : "Something went wrong.",
    );
    return undefined;
  }
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  runWithLoadingToast,
  toast,
  useToastManager,
};
