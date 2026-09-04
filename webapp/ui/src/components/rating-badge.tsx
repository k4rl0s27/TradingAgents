import { Badge } from "@/components/ui/badge"

export function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <Badge variant="outline">—</Badge>
  const map: Record<string, string> = {
    Buy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300",
    Overweight: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300",
    Hold: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
    Underweight: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
    Sell: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
    REVIEW: "bg-muted text-muted-foreground",
  }
  const cls = map[rating] ?? "bg-muted text-muted-foreground"
  return <Badge variant="outline" className={cls}>{rating}</Badge>
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-emerald-600 text-white">Completed</Badge>
  if (status === "running") return <Badge variant="secondary" className="animate-pulse">Running…</Badge>
  return <Badge variant="destructive">Failed</Badge>
}
