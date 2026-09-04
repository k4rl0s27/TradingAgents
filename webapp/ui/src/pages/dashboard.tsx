import { Link } from "react-router-dom"
import { ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp, Wallet } from "lucide-react"
import { api } from "@/api/client"
import type { Holding } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useData } from "@/lib/useData"
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils"

function CardStat({
  label,
  value,
  sub,
  positive,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold tracking-tight ${positive === undefined ? "" : positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {value}
        </div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  )
}

function HoldingsTable({ holdings, totalValue }: { holdings: Holding[]; totalValue: number }) {
  if (holdings.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No holdings yet.{" "}
        <Link to="/portfolio" className="text-primary underline underline-offset-4">
          Add your first position
        </Link>
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Day</TableHead>
            <TableHead className="text-right">Weight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => {
            const up = (h.day_change ?? 0) >= 0
            const weight = totalValue > 0 ? ((h.market_value ?? 0) / totalValue) * 100 : 0
            return (
              <TableRow key={h.id}>
                <TableCell>
                  <div className="font-medium">{h.ticker}</div>
                  <div className="text-xs text-muted-foreground">{formatNumber(h.quantity, 0)} {h.asset_type === "crypto" ? "coins" : "shares"}</div>
                </TableCell>
                <TableCell className="text-right">{formatMoney(h.current_price)}</TableCell>
                <TableCell className="text-right font-medium">{formatMoney(h.market_value)}</TableCell>
                <TableCell className={`text-right ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {up ? <ArrowUpRight className="inline size-3.5" /> : <ArrowDownRight className="inline size-3.5" />}
                  {formatMoney(h.day_change)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{weight.toFixed(1)}%</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default function DashboardPage() {
  const { data, loading, error, refresh } = useData(() => api.summary(), [])

  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  if (!data) return null

  const cost = data.holdings_cost
  const pnl = data.market_value - cost
  const dayChange = data.holdings.reduce((s, h) => s + (h.day_change ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your portfolio at today's prices</p>
        </div>
        <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh prices">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <CardStat label="Total value" value={formatMoney(data.total_value)} />
        <CardStat label="Cash" value={formatMoney(data.cash)} />
        <CardStat
          label="Unrealized P&L"
          value={formatMoney(pnl)}
          sub={cost > 0 ? formatPercent((pnl / cost) * 100) : undefined}
          positive={pnl >= 0}
        />
        <CardStat label="Day change" value={formatMoney(dayChange)} positive={dayChange >= 0} />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-muted-foreground" /> Holdings
            </CardTitle>
          </div>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {formatMoney(data.market_value)} invested {formatMoney(cost)}
          </Badge>
        </CardHeader>
        <CardContent>
          <HoldingsTable holdings={data.holdings} totalValue={data.total_value} />
        </CardContent>
      </Card>

      {data.recent_transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-muted-foreground" /> Recent activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recent_transactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={tx.transaction_type === "buy" ? "default" : "secondary"}>
                    {tx.transaction_type.toUpperCase()}
                  </Badge>
                  <span className="font-medium">{tx.ticker}</span>
                  <span className="text-muted-foreground">{formatNumber(tx.quantity)} @ {formatMoney(tx.price)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{tx.date}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
