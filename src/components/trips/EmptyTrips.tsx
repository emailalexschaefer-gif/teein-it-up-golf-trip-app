export default function EmptyTrips() {
  return (
    <div className="text-center py-16 px-4">
      <p className="text-5xl mb-4">⛳</p>
      <h2 className="text-lg font-bold text-text mb-2">No trips yet</h2>
      <p className="text-text-muted text-sm mb-6 max-w-xs mx-auto">
        Create your first golf trip and invite your group. All the organisation,
        scoring and memories — in one place.
      </p>
      <a
        href="/trips/new"
        className="inline-block bg-brand-600 text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-brand-700 transition-colors"
      >
        Create a trip
      </a>
      <p className="text-text-subtle text-xs mt-4">
        Have an invite link? Ask your organiser to resend it.
      </p>
    </div>
  )
}
