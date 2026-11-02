import { useEffect, useRef, type ReactNode } from 'react'

/** Bottom sheet on phones, centered dialog on wider screens. Escape and backdrop close it. */
export function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])
  return <div className="overlay sheetOverlay" onClick={() => closeRef.current()}>
    <div ref={panelRef} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="sheetHeader">
        <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="iconPill sheetClose" onClick={() => closeRef.current()} aria-label="Close">×</button>
      </div>
      <div className="sheetBody">{children}</div>
    </div>
  </div>
}
