import type { ReactNode } from "react";

type BadgeProps = {
  /** "info" for actions (Decode JWT, Expand JSON), the others for status, always with words. */
  readonly tone: "info" | "ok" | "warn" | "danger";
  readonly children: ReactNode;
  /** Given, the badge is a button. */
  readonly onClick?: () => void;
};

export function Badge({ tone, children, onClick }: BadgeProps) {
  const className = `badge badge-${tone}`;
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  );
}
