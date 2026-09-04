import { useData } from "@/lib/useData"
import { api } from "@/api/client"
import type { ProviderOption } from "@/api/types"
import { NumberField } from "@/components/number-field"
import { SimpleFINSection } from "@/components/simplefin-section"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { useState, type FormEvent } from "react"

export default function SettingsPage() {
  const { data, loading, error, refresh } = useData(() => api.getSettings(), [])
  const { data: providers, loading: loadingProviders } = useData(() => api.providers(), [])
  const [provider, setProvider] = useState("")
  const [deepModel, setDeepModel] = useState("")
  const [quickModel, setQuickModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [temperature, setTemperature] = useState("")
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<{ deep_models: { display: string; value: string }[]; quick_models: { display: string; value: string }[] } | null>(null)

  const currentProvider = provider || data?.llm_provider || "openai"

  async function loadModels(p: string) {
    if (!p) return
    try {
      const m = await api.providerModels(p)
      setModels(m)
      if (!deepModel) setDeepModel(m.deep_models[0]?.value ?? "custom")
      if (!quickModel) setQuickModel(m.quick_models[0]?.value ?? "custom")
    } catch {
      setModels(null)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!provider && !data?.llm_provider) {
      toast.error("Select a provider")
      return
    }
    if (!apiKey && !data?.api_key_masked) {
      toast.error("Enter your API key")
      return
    }
    setSaving(true)
    try {
      await api.updateSettings({
        llm_provider: currentProvider,
        api_key: apiKey || "keep",
        deep_think_llm: deepModel || null,
        quick_think_llm: quickModel || null,
        temperature: temperature ? Number(temperature) : null,
      })
      toast.success("Settings saved")
      setApiKey("")
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">LLM provider used for analyses</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provider</CardTitle>
            <CardDescription>Keys are stored encrypted on the server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              {loadingProviders ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <Select
                  value={currentProvider}
                  onValueChange={(p) => {
                    setProvider(p)
                    loadModels(p)
                  }}
                >
                  <SelectTrigger className="sm:max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(providers?.providers ?? []).map((p: ProviderOption) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {data?.api_key_masked && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{data.api_key_masked}</Badge>
                <span className="text-xs text-muted-foreground">stored key — leave blank to keep</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s-key">API key</Label>
              <Input
                id="s-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={data?.api_key_masked ? "••••••••" : "sk-…"}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Deep model</Label>
                <Select value={deepModel || data?.deep_think_llm || ""} onValueChange={setDeepModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {models?.deep_models.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.display}</SelectItem>
                    ))}
                    <SelectItem value="custom">Custom model ID…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Quick model</Label>
                <Select value={quickModel || data?.quick_think_llm || ""} onValueChange={setQuickModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {models?.quick_models.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.display}</SelectItem>
                    ))}
                    <SelectItem value="custom">Custom model ID…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-temp">Temperature</Label>
                <NumberField id="s-temp" value={temperature} onChange={setTemperature} placeholder={String(data?.temperature ?? "")} min={0} step={0.1} />
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <SimpleFINSection />
    </div>
  )
}
