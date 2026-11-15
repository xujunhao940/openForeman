import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Check } from "@gravity-ui/icons"
import { cn } from "@/lib/utils"

const DropdownMenu = MenuPrimitive.Root
const DropdownMenuTrigger = MenuPrimitive.Trigger
const DropdownMenuGroup = MenuPrimitive.Group
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup

function DropdownMenuContent({ className, side = "bottom", sideOffset = 4, align = "start", alignOffset = 0, children, ...props }: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "side" | "sideOffset" | "align" | "alignOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} className="z-50 outline-none">
        <MenuPrimitive.Popup data-slot="dropdown-menu-content" className={cn("z-50 min-w-32 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none", className)} {...props}>
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, onSelect, onClick, children, ...props }: MenuPrimitive.Item.Props & { onSelect?: (event: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <MenuPrimitive.Item data-slot="dropdown-menu-item" className={cn("relative flex w-full cursor-default items-center gap-2 rounded-xl px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)} onClick={(event) => { onClick?.(event); onSelect?.(event) }} {...props}>
      {children}
    </MenuPrimitive.Item>
  )
}

function DropdownMenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={cn("relative flex w-full cursor-default items-center gap-2 rounded-xl py-1.5 pe-8 ps-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)} {...props}>
      <MenuPrimitive.CheckboxItemIndicator className="absolute end-2 inline-flex size-4 items-center justify-center"><Check aria-hidden="true" /></MenuPrimitive.CheckboxItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={cn("relative flex w-full cursor-default items-center gap-2 rounded-xl py-1.5 pe-8 ps-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50", className)} {...props}>
      <MenuPrimitive.RadioItemIndicator className="absolute end-2 inline-flex size-4 items-center justify-center"><Check aria-hidden="true" /></MenuPrimitive.RadioItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel data-slot="dropdown-menu-label" className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuGroup, DropdownMenuLabel }
