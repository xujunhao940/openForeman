import * as React from "react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" className={cn("relative flex w-full flex-col overflow-hidden rounded-3xl border border-border bg-background focus-within:ring-2 focus-within:ring-ring/30", className)} {...props} />
}

function InputGroupAddon({ className, align = "inline-start", ...props }: React.ComponentProps<"div"> & { align?: "inline-start" | "inline-end" | "block-start" | "block-end" }) {
  const alignment = align.startsWith("block") ? "flex-row" : "items-center"
  const order = align === "block-start" ? "order-first" : align === "block-end" ? "order-last" : ""
  return <div data-slot="input-group-addon" data-align={align} className={cn("flex gap-2 px-3 py-2", alignment, order, className)} {...props} />
}

function InputGroupButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="input-group-button" className={cn("shrink-0", className)} {...props} />
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<typeof Textarea>) {
  return <Textarea data-slot="input-group-control" className={cn("min-h-16 w-full resize-none border-0 bg-transparent px-3 py-2 shadow-none outline-none focus-visible:ring-0", className)} {...props} />
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea }
