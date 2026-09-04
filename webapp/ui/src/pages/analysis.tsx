import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Eye, Play } from "lucide-react"
import { api } from "@/api/client"
import type { AnalysisDepth, AnalysisDetail, AnalysisRun } from "@/api/types"
import { AnalysisResults, RunStats } from "@/components/analysis-results"
import { DateField } from "@/components/date-field"
import { RatingBadge, StatusBadge } from "@/components/rating-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useData } from "@/lib/useData"
import { formatDate } from "@/lib/utils"

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
            <Label>Analysis date</Label>
            <DateField value={date} onChange={setDate} toDate={new Date()} />
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

/** Past-analysis detail as a dialog: the PM's final decision leads, glowing. */
function AnalysisDetailDialog({ run, onClose }: { run: AnalysisRun; onClose: () => void }) {
  const [detail, setDetail] = useState<AnalysisDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    api
      .analysisDetail(run.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [run.id])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88dvh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="border-b px-5 py-4 pr-14 sm:px-6">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              {run.ticker}
              <span className="font-normal text-muted-foreground">
                · {formatDate(run.analysis_date)} · {run.analysis_depth}
              </span>
            </DialogTitle>
            <div className="ml-auto flex items-center gap-2">
              <StatusBadge status={run.status} />
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {error ? (
            <p className="py-8 text-center text-sm text-red-500">{error}</p>
          ) : !detail ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {detail.run.status === "completed" && <RunStats run={detail.run} />}
              {detail.run.status === "failed" && detail.run.error_message && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {detail.run.error_message}
                </p>
              )}
              {detail.results.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No agent outputs stored for this run.</p>
              ) : (
                <AnalysisResults results={detail.results} />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HistoryTab() {
  const { data, loading, error } = useData(() => api.analysisHistory({ page: 1, per_page: 30 }), [])
  const [selected, setSelected] = useState<AnalysisRun | null>(null)

  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  if (!data) return null
  if (data.items.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No analyses yet — run your first one above.</p>
  }

  return (
    <>
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
              <TableRow
                key={run.id}
                className="cursor-pointer"
                onClick={() => setSelected(run)}
              >
                <TableCell className="font-medium">{run.ticker}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{formatDate(run.analysis_date)}</TableCell>
                <TableCell className="hidden capitalize text-muted-foreground md:table-cell">{run.analysis_depth}</TableCell>
                <TableCell><StatusBadge status={run.status} /></TableCell>
                <TableCell className="text-right"><RatingBadge rating={run.rating} /></TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Open analysis ${run.id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelected(run)
                    }}
                  >
                    <Eye className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data.items.length > 0 && data.total > data.items.length && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {data.items.length} of {data.total} — pagination lands with the next batch of runs.
        </p>
      )}

      {selected && <AnalysisDetailDialog run={selected} onClose={() => setSelected(null)} />}
    </>
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
