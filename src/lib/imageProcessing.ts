/**
 * Extracted from ProfileForm.tsx's own local processImageFile — same
 * implementation, unchanged, just made reusable. A center-crop to a
 * square, resized to targetSize, encoded as JPEG. Not an interactive
 * reposition/zoom tool — that remains a larger feature not attempted
 * here, matching the original's own scope note.
 */
export async function processImageFile(file: File, targetSize = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const size = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - size) / 2
  const sy = (bitmap.height - size) / 2

  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, targetSize, targetSize)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not process image'))),
      'image/jpeg', 0.85,
    )
  })
}
