import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card"
import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root
const HoverCardTrigger = HoverCardPrimitive.Trigger

function HoverCardContent({ className, side = "bottom", sideOffset = 4, align = "center", alignOffset = 0, ...props }: HoverCardPrimitive.Popup.Props & Pick<HoverCardPrimitive.Positioner.Props, "side" | "sideOffset" | "align" | "alignOffset">) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} className="z-50">
        <HoverCardPrimitive.Popup data-slot="hover-card-content" className={cn("z-50 w-64 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none", className)} {...props} />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
