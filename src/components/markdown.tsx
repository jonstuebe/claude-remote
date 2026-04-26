import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "../lib/cn";

const components: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("whitespace-pre-wrap break-words", className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn("underline underline-offset-2 hover:opacity-80", className)}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("list-disc space-y-1 pl-5", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("list-decimal space-y-1 pl-5", className)} {...props} />
  ),
  li: ({ className, ...props }) => <li className={cn("leading-snug", className)} {...props} />,
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-2 mb-1 text-base font-semibold", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-2 mb-1 text-base font-semibold", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-2 mb-1 text-sm font-semibold", className)} {...props} />
  ),
  h4: ({ className, ...props }) => (
    <h4 className={cn("mt-2 mb-1 text-sm font-semibold", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("border-l-2 border-current/30 pl-3 italic opacity-90", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("my-2 border-current/20", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  code: ({ className, children, ...props }) => {
    // Inline code only — fenced blocks are wrapped in <pre> by `pre` below.
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[0.85em]", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          "rounded bg-current/10 px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-1 max-h-80 overflow-x-auto rounded-md bg-current/10 p-2 text-xs",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-1 overflow-x-auto">
      <table className={cn("w-full border-collapse text-xs", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn("border border-current/20 px-2 py-1 text-left font-semibold", className)}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-current/20 px-2 py-1 align-top", className)} {...props} />
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("space-y-2 leading-relaxed [&>*:first-child]:mt-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
