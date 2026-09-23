'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ViewerProof = { name: string; contentType?: string; url: string }

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25

export function PaymentProofViewer({ proofs, initial = 0, onClose }: { proofs: ViewerProof[]; initial?: number; onClose: () => void }) {
  const [index, setIndex] = useState(initial)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const touch = useRef<number | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const proof = proofs[index]
  const proofContentTypeRef = useRef(proof?.contentType)
  proofContentTypeRef.current = proof?.contentType

  const move = (delta: number) => {
    setFailed(false)
    setZoom(MIN_ZOOM)
    setIndex(value => (value + delta + proofs.length) % proofs.length)
  }

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const background = [...document.body.children].filter(element => !element.classList.contains('proof-viewer-backdrop'))
    const previousInert = background.map(element => element.hasAttribute('inert'))
    background.forEach(element => element.setAttribute('inert', ''))
    closeRef.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), iframe, [href], [tabindex]:not([tabindex="-1"])') ?? [])]
        if (!focusable.length) { event.preventDefault(); return }
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
      if (event.key === 'ArrowLeft' && proofs.length > 1) move(-1)
      if (event.key === 'ArrowRight' && proofs.length > 1) move(1)
      if ((event.key === '+' || event.key === '=') && proofContentTypeRef.current !== 'application/pdf') {
        setZoom(value => Math.min(MAX_ZOOM, value + ZOOM_STEP))
      }
      if (event.key === '-' && proofContentTypeRef.current !== 'application/pdf') {
        setZoom(value => Math.max(MIN_ZOOM, value - ZOOM_STEP))
      }
    }

    document.addEventListener('keydown', key)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = ''
      background.forEach((element, itemIndex) => { if (!previousInert[itemIndex]) element.removeAttribute('inert') })
      triggerRef.current?.focus()
    }
  }, [proofs.length, onClose])

  if (!proof) return null
  const pdf = proof.contentType === 'application/pdf' || /\.pdf$/i.test(proof.name)

  return createPortal(
    <div className="proof-viewer-backdrop" role="dialog" aria-modal="true" aria-label="Payment proof viewer" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="proof-viewer" onTouchStart={event => { touch.current = event.touches[0].clientX }} onTouchEnd={event => {
        if (touch.current == null) return
        const delta = event.changedTouches[0].clientX - touch.current
        if (Math.abs(delta) > 45 && proofs.length > 1) move(delta > 0 ? -1 : 1)
        touch.current = null
      }}>
        <header>
          <div><strong>{proof.name}</strong><span>{pdf ? 'PDF' : 'Image'} · {index + 1} of {proofs.length}</span></div>
          {!pdf && <div className="proof-zoom" role="group" aria-label="Image zoom">
            <button type="button" onClick={() => setZoom(value => Math.max(MIN_ZOOM, value - ZOOM_STEP))} disabled={zoom === MIN_ZOOM} aria-label="Zoom out">−</button>
            <output aria-live="polite" aria-label="Zoom level">{zoom === MIN_ZOOM ? 'Fit' : `${Math.round(zoom * 100)}%`}</output>
            <button type="button" onClick={() => setZoom(value => Math.min(MAX_ZOOM, value + ZOOM_STEP))} disabled={zoom === MAX_ZOOM} aria-label="Zoom in">+</button>
          </div>}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close proof viewer">×</button>
        </header>
        <div className={`proof-stage ${zoom > MIN_ZOOM ? 'zoomed' : ''}`}>
          {proofs.length > 1 && <button className="proof-arrow left" type="button" onClick={() => move(-1)} aria-label="Previous proof">‹</button>}
          {failed ? <div className="proof-error"><strong>Proof could not be loaded</strong><button type="button" onClick={() => setFailed(false)}>Retry</button></div> : pdf ? (
            <iframe title={proof.name} src={`${proof.url}#view=Fit&zoom=page-fit`} onError={() => setFailed(true)} />
          ) : (
            <div className="proof-image-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img src={proof.url} alt={proof.name} onDoubleClick={() => setZoom(value => value === MIN_ZOOM ? 2 : MIN_ZOOM)} onError={() => setFailed(true)} />
            </div>
          )}
          {proofs.length > 1 && <button className="proof-arrow right" type="button" onClick={() => move(1)} aria-label="Next proof">›</button>}
        </div>
        {proofs.length > 1 && <footer>{proofs.map((item, itemIndex) => <button type="button" key={`${item.url}-${itemIndex}`} className={itemIndex === index ? 'active' : ''} onClick={() => { setIndex(itemIndex); setFailed(false); setZoom(MIN_ZOOM) }} aria-label={`View proof ${itemIndex + 1}`} aria-current={itemIndex === index ? 'true' : undefined} />)}</footer>}
      </section>
    </div>,
    document.body,
  )
}
