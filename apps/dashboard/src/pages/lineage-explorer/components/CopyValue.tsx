/**
 * @file CopyValue.tsx
 * @description Inline clipboard copy trigger with temporary visual feedback.
 */

import type { JSX } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyValueProps {
  /** Text content to be copied to system clipboard */
  value?: string;
  /** Unique identifier for this copy trigger to manage active visual state */
  id: string;
  /** Currently active copied ID across parent component */
  copied: string | null;
  /** Callback fired when user clicks copy button */
  onCopy: (value: string, id: string) => void;
}

/**
 * CopyValue renders an interactive button with a copy icon.
 * Upon clicking, it transitions to a green checkmark and "Copied" text
 * for visual confirmation.
 */
export function CopyValue({
  value,
  id,
  copied,
  onCopy,
}: CopyValueProps): JSX.Element | null {
  if (!value) return null;

  const isCopied = copied === id;

  return (
    <button
      type="button"
      onClick={() => onCopy(value, id)}
      title="Copy to clipboard"
      className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-primary hover:text-primary/75 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      {isCopied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
      {isCopied ? 'Copied' : 'Copy'}
    </button>
  );
}
