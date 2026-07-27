import Component from "@/components/login-btn"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-center text-xl font-semibold">
          Sign In to ContextTube
        </h2>
        <div className="flex flex-col items-center gap-4 text-center">
          <Component />
        </div>
      </div>
    </div>
  )
}
