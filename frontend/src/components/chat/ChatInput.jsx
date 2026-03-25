import { useRef, useEffect } from 'react'

export default function ChatInput({ onSubmit, disabled }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.min(ref.current.scrollHeight, 112) + 'px'
    }
  })

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const val = ref.current?.value.trim()
      if (val && !disabled) {
        onSubmit(val)
        ref.current.value = ''
        ref.current.style.height = 'auto'
      }
    }
  }

  function onClickSend() {
    const val = ref.current?.value.trim()
    if (val && !disabled) {
      onSubmit(val)
      ref.current.value = ''
      ref.current.style.height = 'auto'
    }
  }

  return (
    <div className="flex items-end gap-2 p-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
      <textarea
        ref={ref}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="Ask Research360…"
        rows={1}
        className="flex-1 resize-none bg-surface border border-line rounded-lg px-4 py-2.5 text-sm text-ink placeholder-fade focus:outline-none focus:border-indigo-500 disabled:opacity-50 transition-colors overflow-hidden"
      />
      <button
        onClick={onClickSend}
        disabled={disabled}
        className="shrink-0 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
      >
        Send
      </button>
    </div>
  )
}
