export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <p className="text-brand-600 font-bold text-2xl tracking-tight">Teein&apos; It Up</p>
        <p className="text-text-muted text-sm mt-1">Run Your Golf Trip Like A Pro</p>
      </div>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-card p-8">
        {children}
      </div>
    </div>
  )
}
