import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, CircleDollarSign, ShieldAlert } from "lucide-react"
import { api } from "@/api/client"
import type { AnalysisDetail } from "@/api/types"
import { AnalysisResults, RunStats } from "@/components/analysis-results"
import { StatusBadge } from "@/components/rating-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/utils"

interface LiveEvent {
  type: "agent" | "status" | "complete" | "error"
  agent_name?: string
  content?: string
  rating?: string
  entry_price?: number | null
  stop_loss?: number | null
  error?: string
}

function useAnalysis(id: number) {
  const [detail, setDetail] = useState<AnalysisDetail | null>(null)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    let cancelled = false
    setEvents([])
    setError(null)
    setDetail(null)

    async function load() {
      try {
        const d = await api.analysisDetail(id)
        if (cancelled) return
        setDetail(d)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void load()

    // While running, follow the SSE stream. EventSource auto-reconnects, and a
    // status poll covers the case where the stream went away (e.g. the phone
    // screen locked mid-run) — analysis keeps running server-side.
    const poll = window.setInterval(async () => {
      try {
        const run = await api.analysisStatus(id)
        if (cancelled) return
        setDetail((prev) => (prev ? { ...prev, run } : prev))
        if (run.status !== "running") {
          const d = await api.analysisDetail(id)
          if (!cancelled) setDetail(d)
        }
      } catch {
        /* transient */
      }
    }, 8000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      esRef.current?.close()
      esRef.current = null
    }
  }, [id])

  // Open the SSE stream once we know the run is still going.
  useEffect(() => {
    if (!detail || detail.run.status !== "running") return
    if (esRef.current) return
    const es = new EventSource(api.analysisStreamUrl(detail.run.id))
    esRef.current = es
    es.addEventListener("agent", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as LiveEvent
      setEvents((prev) => [...prev, { ...ev, type: "agent" }])
    })
    es.addEventListener("status", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as LiveEvent
      setEvents((prev) => [...prev, { ...ev, type: "status" }])
    })
    es.addEventListener("complete", (e) => {
      setEvents((prev) => [...prev, { ...(JSON.parse((e as MessageEvent).data) as LiveEvent), type: "complete" }])
      es.close()
      esRef.current = null
    })
    es.addEventListener("error", () => {
      setEvents((prev) => [...prev, { type: "error", error: "Stream ended" }])
      es.close()
      esRef.current = null
    })
    return () => {
      es.close()
      esRef.current = null
    }
  }, [detail?.run.id, detail?.run.status])

  return { detail, events, error }
}

export default function AnalysisDetailPage() {
  const { id } = useParams()
  const runId = Number(id)
  const { detail, events, error } = useAnalysis(Number.isFinite(runId) ? runId : 0)
  const run = detail?.run

  if (error && !detail) {
    return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  }
  if (!run) return <Skeleton className="h-64 w-full" />

  const liveAgents = events.filter((e) => e.type === "agent")

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/analysis"><ArrowLeft className="size-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {run.ticker} <span className="text-muted-foreground">· {formatDate(run.analysis_date)}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Analysis #{run.id} · {run.analysis_depth} depth
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
        </div>
      </div>

      {run.status === "completed" && <RunStats run={run} />}

      {run.status === "running" && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            Analysis in progress — the team of agents is working. You can leave this page and come back.
          </CardContent>
        </Card>
      )}

      {run.status === "failed" && run.error_message && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-2 py-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>{run.error_message}</span>
          </CardContent>
        </Card>
      )}

      {/* Live streamed agents (running view) */}
      {run.status === "running" &&
        liveAgents.map((ev, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                {ev.agent_name} <CircleDollarSign className="size-3.5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{ev.content}</pre>
            </CardContent>
          </Card>
        ))}

      {/* Persisted results (completed view) — PM's final decision pinned first */}
      {run.status !== "running" && detail && detail.results.length > 0 && (
        <AnalysisResults results={detail.results} />
      )}
    </div>
  )
}
