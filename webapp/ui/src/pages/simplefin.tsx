import { useState } from "react"
import { toast } from "sonner"
import { Link } from "react-router-dom"
import { PiggyBank, RefreshCw, Unplug } from "lucide-react"
import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useData } from "@/lib/useData"
import { formatMoney } from "@/lib/utils"

function ConnectFlow({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("")
  const [accounts, setAccounts] = useState<{ account_id: string; name: string; org_name: string }[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function connect() {
    if (!token.trim()) {
      toast.error("Paste your SimpleFIN token")
      return
    }
    setBusy(true)
    try {
      const resp = await api.simplefinConnect(token.trim())
      setAccounts(resp.accounts)
      setToken("")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function link(acc: { account_id: string; name: string; org_name: string }) {
    setBusy(true)
    try {
      await api.simplefinLink({ account_id: acc.account_id, account_name: acc.name, org_name: acc.org_name })
      toast.success(`Linked to ${acc.name}`)
      setAccounts(null)
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="size-4" /> Connect SimpleFIN</CardTitle>
        <CardDescription>
          Your brokerage likely offers a free SimpleFIN token. Get yours at{" "}
          <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            SimpleFIN Bridge
          </a>{" "}
          and paste it here. Holdings, transactions and cash sync automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {accounts === null ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sf-token">SimpleFIN token</Label>
              <Input id="sf-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste token…" className="font-mono" />
            </div>
            <Button onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect"}</Button>
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts found on this token. Make sure it has connected institutions.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Choose the account to monitor:</p>
            {accounts.map((acc) => (
              <Button key={acc.account_id} variant="outline" className="w-full justify-start" disabled={busy} onClick={() => link(acc)}>
                <span className="truncate">{acc.name || acc.account_id}</span>
                {acc.org_name && <span className="ml-auto text-xs text-muted-foreground">{acc.org_name}</span>}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function SimpleFINPage() {
  const { data, loading, error, refresh } = useData(() => api.simplefinStatus(), [])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function sync() {
    setSyncing(true)
    try {
      const res = await api.simplefinSync()
      toast.success(
        `${res.holdings_synced} holdings, ${res.transactions_synced} transactions, cash ${formatMoney(res.cash_balance)}`
      )
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  if (loading && !data) return <Skeleton className="h-40 w-full" />
  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SimpleFIN</h1>
        <p className="text-sm text-muted-foreground">Automatic portfolio sync from your brokerage</p>
      </div>

      {!data.connected ? (
        <ConnectFlow onDone={refresh} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected</CardTitle>
            <CardDescription>
              Account <span className="font-medium text-foreground">{data.linked_account?.account_name}</span>
              {data.linked_account?.org_name ? ` (${data.linked_account.org_name})` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={sync} disabled={syncing}>
              <RefreshCw className="size-4" /> {syncing ? "Syncing…" : "Sync now"}
            </Button>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                <Unplug className="size-4" /> Disconnect
              </Button>
              <DialogContent className="sm:max-w-xs">
                <DialogHeader>
                  <DialogTitle>Disconnect SimpleFIN?</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Synced holdings and transactions will be removed. Anything you entered manually stays.
                </p>
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await api.simplefinDisconnect()
                        toast.success("Disconnected")
                        setConfirmOpen(false)
                        refresh()
                      } catch (err) {
                        toast.error((err as Error).message)
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Synced positions are managed by SimpleFIN — edit them at your brokerage, then{" "}
        <Link to="/portfolio" className="underline underline-offset-2">refresh the portfolio</Link>.
      </p>
    </div>
  )
}
