import { Sparkles } from "lucide-react"
import type { AnalysisResult, AnalysisRun } from "@/api/types"
import { RatingBadge } from "@/components/rating-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney, prettifyAgentName } from "@/lib/utils"

const PM_AGENT = "portfolio_manager"

interface AnalysisResultsProps {
  results: AnalysisResult[]
  /** Run metadata used to enrich the Portfolio Manager card. */
  run?: Pick<AnalysisRun, "rating" | "entry_price" | "stop_loss"> | null
}

function AgentCard({ result, run }: { result: AnalysisResult; run?: AnalysisResultsProps["run"] }) {
  const isPm = result.agent_name === PM_AGENT
  const header = (
    <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="flex items-center gap-2 text-sm">
        {isPm && <Sparkles className="size-4 text-violet-500" aria-hidden />}
        {prettifyAgentName(result.agent_name)}
        {!isPm && <span className="text-xs font-normal text-muted-foreground">{result.output_type}</span>}
      </CardTitle>
      {isPm && run && (
        <div className="flex items-center gap-2">
          <RatingBadge rating={run.rating ?? null} />
        </div>
      )}
    </CardHeader>
  )
  const body = (
    <CardContent>
      {isPm && run && (run.entry_price != null || run.stop_loss != null) && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          {run.entry_price != null && (
            <span>
              <span className="text-muted-foreground">Entry </span>
              <span className="font-semibold">{formatMoney(run.entry_price)}</span>
            </span>
          )}
          {run.stop_loss != null && (
            <span>
              <span className="text-muted-foreground">Stop </span>
              <span className="font-semibold text-red-600 dark:text-red-400">{formatMoney(run.stop_loss)}</span>
            </span>
          )}
        </div>
      )}
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{result.content}</pre>
    </CardContent>
  )

  if (!isPm) {
    return (
      <Card>
        {header}
        {body}
      </Card>
    )
  }

  // The Portfolio Manager holds the final decision: give it a subtle
  // gradient "AI" border + glow so it reads as the conclusion, not another
  // report.
  return (
    <div className="rounded-xl bg-gradient-to-br from-violet-500/80 via-sky-400/50 to-cyan-400/80 p-px shadow-[0_0_30px_-10px_rgba(139,92,246,0.55)]">
      <div className="rounded-[11px] bg-card">
        {header}
        {body}
      </div>
    </div>
  )
}

/** Agent outputs with the Portfolio Manager's final decision pinned first. */
export function AnalysisResults({ results, run }: AnalysisResultsProps) {
  const ordered = [...results].sort(
    (a, b) => Number(b.agent_name === PM_AGENT) - Number(a.agent_name === PM_AGENT)
  )
  return (
    <div className="space-y-4">
      {ordered.map((r) => (
        <AgentCard key={r.id} result={r} run={run} />
      ))}
    </div>
  )
}
