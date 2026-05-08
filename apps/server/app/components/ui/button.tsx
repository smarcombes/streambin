import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm";
};

function classesForVariant(variant: ButtonProps["variant"]): string {
  if (variant === "outline") {
    return "border border-black/20 bg-transparent text-black hover:bg-black/5 dark:border-white/20 dark:text-white dark:hover:bg-white/10";
  }
  if (variant === "ghost") {
    return "bg-transparent text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/10";
  }
  return "bg-black text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/85";
}

function classesForSize(size: ButtonProps["size"]): string {
  if (size === "sm") {
    return "h-8 px-3 text-xs";
  }
  return "h-10 px-4 text-sm";
}

export function Button({
  className = "",
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/40 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-white/40 ${classesForVariant(variant)} ${classesForSize(size)} ${className}`}
      {...props}
    />
  );
}
