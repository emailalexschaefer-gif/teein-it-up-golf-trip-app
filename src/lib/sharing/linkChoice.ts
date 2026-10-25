/**
 * Which link the organiser is shown after publishing a presentation.
 * Public sharing is OFF by default, and then the only working link is the
 * members-only event page, which sends anyone who is not signed in to the
 * login page. That link must never be presented as one to send to family and
 * friends. The public link (/s/{token}) is the only one that opens without
 * an account.
 */
export interface LinkChoice {
  kind: 'public' | 'members'
  url: string
  heading: string
  copyLabel: string
  warning: string | null
}

export function chooseLink(args: { isPublic: boolean; publicUrl: string; origin: string; tripId: string }): LinkChoice {
  if (args.isPublic) {
    return { kind: 'public', url: args.publicUrl, heading: 'Public viewing link — opens without signing in', copyLabel: 'Copy public link', warning: null }
  }
  return {
    kind: 'members', url: `${args.origin}/trips/${args.tripId}/presentation`,
    heading: 'Members-only link (public sharing is off)', copyLabel: 'Copy members-only link',
    warning: 'People outside the event will be asked to sign in. To share with family and friends, tick “Share with anyone who has the link” above, then Update the presentation to get a public link.',
  }
}
