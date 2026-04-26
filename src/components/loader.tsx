import { cn } from "../lib/cn";

// Adapted from prompt-kit (https://www.prompt-kit.com/docs/loader).
// We currently only need the `dots` variant; the keyframe `bounce-dots`
// lives in src/styles.css. Other variants from upstream can be ported
// here as needed.

export type LoaderSize = "sm" | "md" | "lg";

export type LoaderProps = {
  size?: LoaderSize;
  className?: string;
};

export function DotsLoader({ size = "md", className }: LoaderProps) {
  const dotSize = size === "sm" ? "size-1.5" : size === "lg" ? "size-2.5" : "size-2";
  const containerHeight = size === "sm" ? "h-4" : size === "lg" ? "h-6" : "h-5";
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("flex items-center gap-1", containerHeight, className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "rounded-full bg-current animate-[bounce-dots_1.4s_ease-in-out_infinite]",
            dotSize,
          )}
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Loader(props: LoaderProps) {
  return <DotsLoader {...props} />;
}
