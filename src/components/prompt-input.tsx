import { Tooltip } from "@base-ui-components/react/tooltip";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "../lib/cn";

// Adapted from prompt-kit (https://www.prompt-kit.com/docs/prompt-input).
// The upstream depends on shadcn's <Textarea> + Radix Tooltip; this version
// uses Base UI's Tooltip and a plain <textarea> to match the project stack.

type PromptInputContextType = {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextType | null>(null);

function usePromptInput(): PromptInputContextType {
  const ctx = useContext(PromptInputContext);
  if (!ctx) throw new Error("PromptInput sub-components must be used inside <PromptInput>");
  return ctx;
}

export type PromptInputProps = {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
} & ComponentProps<"div">;

export function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  children,
  disabled = false,
  onClick,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (next: string) => {
    setInternalValue(next);
    onValueChange?.(next);
  };

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!disabled) textareaRef.current?.focus();
    onClick?.(event);
  };

  return (
    <Tooltip.Provider>
      <PromptInputContext.Provider
        value={{
          isLoading,
          value: value ?? internalValue,
          setValue: onValueChange ?? handleChange,
          maxHeight,
          onSubmit,
          disabled,
          textareaRef,
        }}
      >
        <div
          onClick={handleClick}
          className={cn(
            "cursor-text rounded-3xl border border-input bg-background p-2 shadow-xs",
            disabled && "cursor-not-allowed opacity-60",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </Tooltip.Provider>
  );
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean;
  /**
   * When true, the built-in Enter→submit handler is skipped and Enter behaves
   * like a normal textarea newline. The consumer is responsible for triggering
   * onSubmit (e.g. from an explicit Send button). Useful on touch devices.
   */
  disableSubmitOnEnter?: boolean;
} & Omit<ComponentProps<"textarea">, "ref" | "value" | "onChange">;

export function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  disableSubmitOnEnter = false,
  ...props
}: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } = usePromptInput();

  const adjustHeight = (el: HTMLTextAreaElement | null) => {
    if (!el || disableAutosize) return;
    el.style.height = "auto";
    if (typeof maxHeight === "number") {
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    } else {
      el.style.height = `min(${el.scrollHeight}px, ${maxHeight})`;
    }
  };

  const handleRef = (el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    adjustHeight(el);
  };

  useLayoutEffect(() => {
    adjustHeight(textareaRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (disableSubmitOnEnter) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    // Don't submit while an IME composition is in progress (e.g. CJK input).
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <textarea
      ref={handleRef}
      value={value}
      onChange={(event) => {
        adjustHeight(event.target);
        setValue(event.target.value);
      }}
      onKeyDown={handleKeyDown}
      rows={1}
      disabled={disabled}
      className={cn(
        "min-h-11 w-full resize-none border-none bg-transparent pt-1.5 pl-2 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export type PromptInputActionsProps = HTMLAttributes<HTMLDivElement>;

export function PromptInputActions({ children, className, ...props }: PromptInputActionsProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputActionProps = {
  className?: string;
  tooltip: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
};

export function PromptInputAction({
  tooltip,
  children,
  className,
  side = "top",
}: PromptInputActionProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={(triggerProps) => (
          <span
            {...triggerProps}
            onClick={(event) => {
              event.stopPropagation();
              triggerProps.onClick?.(event);
            }}
          >
            {children}
          </span>
        )}
      />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6}>
          <Tooltip.Popup
            className={cn(
              "rounded-md border border-border/60 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
              className,
            )}
          >
            {tooltip}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
