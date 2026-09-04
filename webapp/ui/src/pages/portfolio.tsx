import { useState } from "react"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { api } from "@/api/client"
import type { CashBalance, Holding, Transaction } from "@/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useData } from "@/lib/useData"
import { formatDate, formatMoney, formatNumber } from "@/lib/utils"

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return <p className="py-8 text-center text-sm text-red-500">{error}</p>
}

// ── Holdings ──────────────────────────────────────────────────────────────────

function AddHoldingDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [ticker, setTicker] = useState("")
  const [assetType, setAssetType] = useState("stock")
  const [quantity, setQuantity] = useState("")
  const [avgCost, setAvgCost] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!ticker.trim() || !quantity) {
      toast.error("Ticker and quantity are required")
      return
    }
    setSaving(true)
    try {
      await api.addHolding({
        ticker: ticker.trim(),
        asset_type: assetType,
        quantity: Number(quantity),
        avg_cost: avgCost ? Number(avgCost) : null,
      })
      toast.success(`${ticker.trim().toUpperCase()} added`)
      setOpen(false)
      setTicker("")
      setQuantity("")
      setAvgCost("")
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button asChild size="sm" variant="outline">
        <span onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Add holding
        </span>
      </Button>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add holding</DialogTitle>
          <DialogDescription>Add or update a position in your portfolio.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h-ticker">Ticker</Label>
              <Input id="h-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL" autoCapitalize="characters" />
            </div>
            <div className="space-y-1.5">
              <Label>Asset type</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger aria-label="Asset type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h-qty">Quantity</Label>
              <Input id="h-qty" type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-cost">Avg cost</Label>
              <Input id="h-cost" type="number" inputMode="decimal" min="0" step="any" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="150.00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HoldingsTab() {
  const { data, loading, error, refresh } = useData(() => api.summary(), [])
  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <ErrorNote error={error} />
  if (!data) return null

  async function remove(h: Holding) {
    try {
      await api.deleteHolding(h.id)
      toast.success(`${h.ticker} removed`)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const rows = data.holdings
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddHoldingDialog onSaved={refresh} />
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No holdings. Add your first position above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg cost</TableHead>
                <TableHead className="text-right">Last</TableHead>
                <TableHead className="text-right">Day</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right w-10" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((h) => {
                const up = (h.day_change ?? 0) >= 0
                return (
                  <TableRow key={h.id}>
                    <TableCell>
                      <span className="font-medium">{h.ticker}</span>
                      {h.source === "simplefin" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">sync</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(h.quantity, 4)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatMoney(h.avg_cost)}</TableCell>
                    <TableCell className="text-right">{formatMoney(h.current_price)}</TableCell>
                    <TableCell className={`text-right ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {formatMoney(h.day_change)}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(h.market_value)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${h.ticker}`} onClick={() => remove(h)}>
                        <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ── Transactions ──────────────────────────────────────────────────────────────

function AddTransactionDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [ticker, setTicker] = useState("")
  const [kind, setKind] = useState<"buy" | "sell">("buy")
  const [quantity, setQuantity] = useState("")
  const [price, setPrice] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [fees, setFees] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!ticker.trim() || !quantity || !price || !date) {
      toast.error("Ticker, quantity, price and date are required")
      return
    }
    setSaving(true)
    try {
      await api.addTransaction({
        ticker: ticker.trim(),
        transaction_type: kind,
        quantity: Number(quantity),
        price: Number(price),
        date,
        fees: fees ? Number(fees) : 0,
      })
      toast.success("Transaction recorded")
      setOpen(false)
      setTicker("")
      setQuantity("")
      setPrice("")
      setFees("")
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button asChild size="sm" variant="outline">
        <span onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Record trade
        </span>
      </Button>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record trade</DialogTitle>
          <DialogDescription>Buying or selling updates the holding automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-ticker">Ticker</Label>
              <Input id="t-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="AAPL" autoCapitalize="characters" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "buy" | "sell")}>
                <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Buy</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-qty">Quantity</Label>
              <Input id="t-qty" type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-price">Price</Label>
              <Input id="t-price" type="number" inputMode="decimal" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-date">Date</Label>
              <Input id="t-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-fees">Fees</Label>
              <Input id="t-fees" type="number" inputMode="decimal" min="0" step="any" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransactionsTab() {
  const { data, loading, error, refresh } = useData(() => api.transactions(), [])
  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <ErrorNote error={error} />
  if (!data) return null

  async function remove(tx: Transaction) {
    try {
      await api.deleteTransaction(tx.id)
      toast.success("Transaction deleted — holding recalculated")
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddTransactionDialog onSaved={refresh} />
      </div>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No transactions recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right w-10" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(tx.date)}</TableCell>
                  <TableCell>
                    <Badge variant={tx.transaction_type === "buy" ? "default" : "secondary"}>{tx.transaction_type === "buy" ? "BUY" : "SELL"}</Badge>
                    <span className="ml-2 font-medium">{tx.ticker}</span>
                    {tx.source === "simplefin" && <Badge variant="outline" className="ml-1 text-[10px]">sync</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(tx.quantity, 4)}</TableCell>
                  <TableCell className="text-right">{formatMoney(tx.price)}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(tx.total_amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label="Delete transaction" onClick={() => remove(tx)}>
                      <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ── Cash ──────────────────────────────────────────────────────────────────────

function CashTab() {
  const { data, loading, refresh } = useData(() => api.cashHistory(), [])
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const current = data && data.length > 0 ? data[0] : null

  async function submit() {
    if (!amount) {
      toast.error("Amount is required")
      return
    }
    setSaving(true)
    try {
      await api.setCash({ amount: Number(amount), date, notes: null })
      toast.success("Cash balance updated")
      setOpen(false)
      setAmount("")
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: CashBalance) {
    try {
      await api.deleteCash(c.id)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (loading && !data) return <Skeleton className="h-40 w-full" />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{formatMoney(current?.amount)}</CardTitle>
          <CardDescription>Current cash balance {current ? `as of ${formatDate(current.date)}` : "— not set yet"}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <Button asChild size="sm">
              <span onClick={() => setOpen(true)}>Update cash</span>
            </Button>
            <DialogContent className="sm:max-w-xs">
              <DialogHeader>
                <DialogTitle>Update cash balance</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="c-amount">Amount</Label>
                  <Input id="c-amount" type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000.00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-date">Date</Label>
                  <Input id="c-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {data && data.length > 0 && (
        <div className="space-y-1">
          {data.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{formatMoney(c.amount)}</span>
                <span className="ml-2 text-muted-foreground">{formatDate(c.date)}</span>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Delete entry" onClick={() => remove(c)}>
                <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">Holdings, trades and cash</p>
      </div>
      <Tabs defaultValue="holdings">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="cash">Cash</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings" className="mt-4"><HoldingsTab /></TabsContent>
        <TabsContent value="transactions" className="mt-4"><TransactionsTab /></TabsContent>
        <TabsContent value="cash" className="mt-4"><CashTab /></TabsContent>
      </Tabs>
    </div>
  )
}

