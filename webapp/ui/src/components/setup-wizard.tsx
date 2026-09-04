import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Check, LineChart } from "lucide-react"
import { api } from "@/api/client"
import type { ProviderOption } from "@/api/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [providers, setProviders] = useState<ProviderOption[] | null>(null)
  const [provider, setProvider] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [models, setModels] = useState<{ deep_models: { display: string; value: string }[]; quick_models: { display: string; value: string }[] } | null>(null)
  const [deep, setDeep] = useState("")
  const [quick, setQuick] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .providers()
      .then((r) => setProviders(r.providers))
      .catch((err) => toast.error(err.message))
  }, [])

  async function pickProvider(p: string) {
    setProvider(p)
    setModels(null)
    setDeep("")
    setQuick("")
    try {
      const m = await api.providerModels(p)
      setModels(m)
      setDeep(m.deep_models[0]?.value ?? "")
      setQuick(m.quick_models[0]?.value ?? "")
    } catch {
      setModels(null)
    }
  }

  async function submit() {
    if (!provider) {
      toast.error("Pick a provider first")
      return
    }
    const selected = providers?.find((p) => p.key === provider)
    const key = apiKey.trim() || (selected?.env_var ? "" : "local") // keyless providers (ollama, bedrock) accept a placeholder
    if (selected?.env_var && !key) {
      toast.error("Enter your API key")
      return
    }
    setBusy(true)
    try {
      await api.initialize({
        llm_provider: provider,
        api_key: key,
        deep_think_llm: deep || null,
        quick_think_llm: quick || null,
      })
      toast.success("Welcome to TradingAgents!")
      onDone()
    } catch (err) {
      toast.error((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LineChart className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">Welcome</CardTitle>
          <CardDescription>Analyses are powered by your own LLM API key — stored encrypted on this server.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {providers.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => pickProvider(p.key)}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    provider === p.key ? "border-primary bg-primary/10" : "hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">{p.display_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{p.env_var ?? "no key required"}</div>
                  {provider === p.key && <Check className="mt-1 size-4 text-primary" />}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="w-key">API key</Label>
            <Input
              id="w-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </div>

          {provider && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Deep model</Label>
                <Select value={deep} onValueChange={setDeep}>
                  <SelectTrigger><SelectValue placeholder="Deep model" /></SelectTrigger>
                  <SelectContent>
                    {models?.deep_models.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.display}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quick model</Label>
                <Select value={quick} onValueChange={setQuick}>
                  <SelectTrigger><SelectValue placeholder="Quick model" /></SelectTrigger>
                  <SelectContent>
                    {models?.quick_models.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.display}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Button className="w-full" onClick={submit} disabled={busy || providers === null}>
            {busy ? "Saving…" : "Complete setup"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
