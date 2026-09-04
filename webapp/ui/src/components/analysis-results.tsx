import type { AnalysisResult, AnalysisRun } from "@/api/types"
import { RatingBadge } from "@/components/rating-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney, prettifyAgentName } from "@/lib/utils"

const PM_AGENT = "portfolio_manager"

/** Summary stat cards shown above the agent outputs of a completed run. */
export function RunStats({ run }: { run: Pick<AnalysisRun, "rating" | "entry_price" | "stop_loss"> | null }) {
  if (!run) return null
  const stat = (label: string, value: React.ReactNode) => (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>{value}</CardContent>
    </Card>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {stat("Rating", <RatingBadge rating={run.rating ?? null} />)}
      {stat("Entry price", <span className="text-xl font-semibold">{formatMoney(run.entry_price)}</span>)}
      {stat("Stop loss", <span className="text-xl font-semibold text-red-600 dark:text-red-400">{formatMoney(run.stop_loss)}</span>)}
    </div>
  )
}

interface AnalysisResultsProps {
  results: AnalysisResult[]
}

function AgentCard({ result }: { result: AnalysisResult }) {
  const isPm = result.agent_name === PM_AGENT
  const content = (
    <>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{prettifyAgentName(result.agent_name)}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{result.content}</pre>
      </CardContent>
    </>
  )

  if (!isPm) return <Card>{content}</Card>

  // The Portfolio Manager holds the final decision: a uniform gradient ring +
  // soft glow marks it as the conclusion rather than another report.
  return (
    <div className="gradient-border shadow-[0_0_34px_-12px_rgba(139,92,246,0.6)]">
      <div className="rounded-[11px] bg-card">{content}</div>
    </div>
  )
}

/** Agent outputs with the Portfolio Manager's final decision pinned first. */
export function AnalysisResults({ results }: AnalysisResultsProps) {
  const ordered = [...results].sort(
    (a, b) => Number(b.agent_name === PM_AGENT) - Number(a.agent_name === PM_AGENT)
  )
  return (
    <div className="space-y-4">
      {ordered.map((r) => (
        <AgentCard key={r.id} result={r} />
      ))}
    </div>
  )
}
