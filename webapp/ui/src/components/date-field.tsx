import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Parse a yyyy-mm-dd string as a LOCAL date (never UTC — avoids day shifts). */
function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

interface DateFieldProps {
  value: string // yyyy-mm-dd
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  /** Earliest selectable date (inclusive) */
  fromDate?: Date
  /** Latest selectable date (inclusive) */
  toDate?: Date
  className?: string
}

/** Shadcn-style date picker backed by a calendar popover (native input replaced). */
export function DateField({ value, onChange, placeholder, disabled, id, fromDate, toDate, className }: DateFieldProps) {
  const selected = value ? toLocalDate(value) : undefined
  const disabledMatchers = [
    ...(fromDate ? [{ before: fromDate }] : []),
    ...(toDate ? [{ after: toDate }] : []),
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-60" aria-hidden />
          {value ?? <span>{placeholder ?? "Pick a date"}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => onChange(day ? toIso(day) : "")}
          disabled={disabledMatchers}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
