/**
 * Browser helpers to hand a generated file to the person: the native share
 * sheet where the browser can share files (iPhone, Android), otherwise a plain
 * download (desktop, older browsers). Never throws for a cancelled share.
 */
export type SaveResult = 'shared' | 'downloaded' | 'cancelled'

export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<SaveResult> {
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null
  const nav = typeof navigator !== 'undefined' ? navigator : null
  if (file && nav && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    let canShareFile = false
    try { canShareFile = nav.canShare({ files: [file] }) } catch { canShareFile = false }
    if (canShareFile) {
      try {
        await nav.share({ files: [file], title })
        return 'shared'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
        // Any other failure (e.g. the browser no longer treats this as a tap): fall through to a download.
      }
    }
  }
  download(blob, filename)
  return 'downloaded'
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function safeFilename(eventName: string, ext: 'png' | 'pdf'): string {
  const base = eventName.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'leaderboard'
  return `${base}-leaderboard.${ext}`
}

/** Text + link share via the native sheet (WhatsApp, Messenger, SMS ...). Returns false when unsupported. */
export async function shareLink(url: string, title: string, text: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'unsupported'
  try {
    await navigator.share({ title, text, url })
    return 'shared'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

/**
 * Decodes the app's own logo into raw RGB + alpha for the PDF. Returns null on
 * any failure (the PDF then simply has no logo; the wordmark and tagline remain).
 */
export async function loadPdfLogo(url: string, size = 160): Promise<{ width: number; height: number; rgb: Uint8Array; alpha: Uint8Array } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      const t = setTimeout(() => reject(new Error('timeout')), 3000)
      i.onload = () => { clearTimeout(t); resolve(i) }
      i.onerror = () => { clearTimeout(t); reject(new Error('load')) }
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    const rgb = new Uint8Array(size * size * 3), alpha = new Uint8Array(size * size)
    for (let i = 0, p = 0, q = 0; i < data.length; i += 4) { rgb[p++] = data[i]; rgb[p++] = data[i + 1]; rgb[p++] = data[i + 2]; alpha[q++] = data[i + 3] }
    return { width: size, height: size, rgb, alpha }
  } catch { return null }
}
