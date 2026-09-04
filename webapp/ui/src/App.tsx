import { Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/app-shell"
import { SetupWizard } from "@/components/setup-wizard"
import { useAuth } from "@/lib/auth"
import AnalysisPage from "@/pages/analysis"
import AnalysisDetailPage from "@/pages/analysis-detail"
import DashboardPage from "@/pages/dashboard"
import PortfolioPage from "@/pages/portfolio"
import SettingsPage from "@/pages/settings"
import LoginPage from "@/pages/login"
import { Skeleton } from "@/components/ui/skeleton"

export default function App() {
  const { state } = useAuth()

  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8">
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }

  if (state.status === "unauthenticated") {
    return <LoginPage />
  }

  // First run: the user has no provider/API key configured yet.
  if (!state.user.is_initialized) {
    return <SetupWizard onDone={() => window.location.reload()} />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/analysis/:id" element={<AnalysisDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
