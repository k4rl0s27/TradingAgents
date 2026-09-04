import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Eye, Play } from "lucide-react"
import { api } from "@/api/client"
import type { AnalysisDepth, AnalysisRun } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useData } from "@/lib/useData"
import { formatDate } from "@/lib/utils"

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

function NewAnalysisForm() {
  const navigate = useNavigate()
  const [ticker, setTicker] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [depth, setDepth] = useState<AnalysisDepth>("medium")
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!ticker.trim() || !date) {
      toast.error("Ticker and date are required")
      return
    }
    setSubmitting(true)
    try {
      const run = await api.runAnalysis({
        ticker: ticker.trim(),
        analysis_type: "regular",
        analysis_depth: depth,
        analysis_date: date,
      })
      toast.success("Analysis started")
      navigate(`/analysis/${run.id}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="a-ticker">Ticker</Label>
            <Input id="a-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="NVDA" autoCapitalize="characters" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-date">Analysis date</Label>
            <Input id="a-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Depth</Label>
          <Select value={depth} onValueChange={(v) => setDepth(v as AnalysisDepth)}>
            <SelectTrigger className="sm:max-w-xs" aria-label="Depth">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick">Quick — market + fundamentals, no debate</SelectItem>
              <SelectItem value="medium">Medium — full analyst team, 1 debate round</SelectItem>
              <SelectItem value="deep">Deep — more news, 2 debate rounds</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Runs the analyst team + bull/bear debate + trader + risk + portfolio manager. An API key is required in Settings.
          </p>
        </div>
        <Button onClick={submit} disabled={submitting}>
          <Play className="size-4" /> {submitting ? "Starting…" : "Run analysis"}
        </Button>
      </CardContent>
    </Card>
  )
}

function HistoryTab() {
  const { data, loading, error } = useData(() => api.analysisHistory({ page: 1, per_page: 30 }), [])
  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  if (!data) return null
  if (data.items.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No analyses yet — run your first one above.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="hidden sm:table-cell">Date</TableHead>
            <TableHead className="hidden md:table-cell">Depth</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Rating</TableHead>
            <TableHead className="w-10 text-right" aria-label="Open" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((run: AnalysisRun) => (
            <TableRow key={run.id}>
              <TableCell className="font-medium">{run.ticker}</TableCell>
              <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{formatDate(run.analysis_date)}</TableCell>
              <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{run.analysis_depth}</TableCell>
              <TableCell><StatusBadge status={run.status} /></TableCell>
              <TableCell className="text-right"><RatingBadge rating={run.rating} /></TableCell>
              <TableCell className="text-right">
                <a href={`/analysis/${run.id}`}>
                  <Button variant="ghost" size="icon-sm" aria-label={`Open analysis ${run.id}`}>
                    <Eye className="size-4" />
                  </Button>
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function AnalysisPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analysis</h1>
        <p className="text-sm text-muted-foreground">Multi-agent trading analysis</p>
      </div>
      <Tabs defaultValue="new">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="new">New</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4"><NewAnalysisForm /></TabsContent>
        <TabsContent value="history" className="mt-4"><HistoryTab /></TabsContent>
      </Tabs>
    </div>
  )
}
