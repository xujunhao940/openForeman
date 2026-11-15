import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg data-slot="spinner" className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3Z" />
    </svg>
  )
}

export { Spinner }
