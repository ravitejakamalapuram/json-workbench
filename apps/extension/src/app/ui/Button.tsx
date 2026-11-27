import type { ComponentPropsWithRef } from "react";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  /** "primary" is the one filled button on a screen (Export, Open file); the rest are text buttons. */
  readonly variant?: "primary" | "text";
};

export function Button({
  variant = "text",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = `button button-${variant}${className ? ` ${className}` : ""}`;
  return <button {...props} type={type} className={classes} />;
}
