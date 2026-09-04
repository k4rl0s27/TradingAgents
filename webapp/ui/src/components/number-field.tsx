import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface NumberFieldProps {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  min?: number
  step?: number
  className?: string
}

/** Numeric input with explicit +/- steppers and native spinners hidden. */
export function NumberField({ value, onChange, id, placeholder, min, step = 1, className }: NumberFieldProps) {
  const bump = (dir: 1 | -1) => {
    const current = value === "" || value === "-" ? 0 : Number(value)
    if (Number.isNaN(current)) return
    const next = Math.round((current + dir * step) * 1e6) / 1e6
    onChange(String(min !== undefined ? Math.max(min, next) : next))
  }
  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pr-9 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div className="absolute inset-y-0 right-0 flex w-8 flex-col">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Increase"
          className="h-1/2 w-full rounded-none rounded-tr-md text-muted-foreground hover:text-foreground"
          onClick={() => bump(1)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Decrease"
          className="h-1/2 w-full rounded-none rounded-br-md text-muted-foreground hover:text-foreground"
          onClick={() => bump(-1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
