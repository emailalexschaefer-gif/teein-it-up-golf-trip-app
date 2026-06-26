export default function TripListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading trips">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2xl shadow-card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-surface-subtle animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-surface-subtle rounded animate-pulse w-3/4" />
            <div className="h-3 bg-surface-subtle rounded animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
