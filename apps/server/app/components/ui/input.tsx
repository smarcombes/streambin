import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`flex h-10 w-full rounded-md border border-black/20 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none ring-offset-white placeholder:text-black/50 focus-visible:ring-2 focus-visible:ring-black/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-black/60 dark:text-white dark:ring-offset-black dark:placeholder:text-white/50 dark:focus-visible:ring-white/30 ${className}`}
      {...props}
    />
  );
}
