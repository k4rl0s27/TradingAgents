import { useEffect, useState } from "react"
import { LineChart, LogIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  const [unconfigured, setUnconfigured] = useState<boolean | null>(null)

  useEffect(() => {
    // GET /auth/login is a 302 when OIDC is configured, a 501 when it is not.
    fetch("/auth/login", { method: "GET", redirect: "manual" })
      .then((r) => setUnconfigured(r.status === 501))
      .catch(() => setUnconfigured(false))
  }, [])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LineChart className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">TradingAgents</CardTitle>
          <CardDescription>Multi-agent trading analysis and portfolio tracking</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" asChild>
            <a href="/auth/login">
              <LogIn className="size-4" /> Sign in
            </a>
          </Button>
          {unconfigured && (
            <p className="text-center text-xs text-muted-foreground">
              Sign-in needs OIDC (OIDC_ISSUER &amp; friends) configured on the server.
              For local development without an IdP, set <code className="rounded bg-muted px-1">WEBAPP_DEV_AUTOLOGIN=1</code> in the server's .env.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
