"use client";

import { useState } from "react";

/**
 * A button that asks "are you sure" in the page instead of with window.confirm. Native dialogs are silently
 * dismissed by embedded browsers and are awkward for screen readers, which left the action looking dead.
 */
export function ConfirmAction({
  label,
  message,
  confirmLabel,
  onConfirm,
  disabled,
  className = "btn",
  testId,
}: {
  label: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)} data-testid={testId}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label="Confirm this action">
      <span className="small" role="alert">{message}</span>{" "}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        data-testid={testId ? `${testId}-confirm` : undefined}
      >
        {confirmLabel}
      </button>{" "}
      <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>Cancel</button>
    </span>
  );
}
