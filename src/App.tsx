import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { buildExportText, buildOperations, type ApiOperation, type OpenApiDocument } from './openapi'

type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; source: string }
  | { kind: 'error'; message: string }

export default function App() {
  const [doc, setDoc] = useState<OpenApiDocument | null>(null)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>({ kind: 'idle' })
  const [url, setUrl] = useState('')
  const [fileName, setFileName] = useState('未选择文件')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [exportText, setExportText] = useState('')

  const operations = useMemo<ApiOperation[]>(() => {
    if (!doc) return []
    return buildOperations(doc)
  }, [doc])

  const visibleOperations = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return operations
    return operations.filter((op) => {
      const tag = (op.tags ?? []).join(' ').toLowerCase()
      return (
        op.path.toLowerCase().includes(q) ||
        op.method.toLowerCase().includes(q) ||
        (op.summary ?? '').toLowerCase().includes(q) ||
        tag.includes(q)
      )
    })
  }, [operations, search])

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected])

  async function loadByUrl() {
    const u = url.trim()
    if (!u) return
    setLoadStatus({ kind: 'loading' })
    setExportText('')
    try {
      const res = await fetch(u)
      if (!res.ok) throw new Error(`加载失败: ${res.status}`)
      const json = (await res.json()) as OpenApiDocument
      setDoc(json)
      setFileName('未选择文件')
      setSelected({})
      setLoadStatus({ kind: 'loaded', source: u })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setLoadStatus({ kind: 'error', message: message + ' (可能是 CORS 跨域限制，请尝试下载文件后导入)' })
    }
  }

  async function loadByFile(file: File) {
    setLoadStatus({ kind: 'loading' })
    setExportText('')
    try {
      const text = await file.text()
      const json = JSON.parse(text) as OpenApiDocument
      setDoc(json)
      setFileName(file.name)
      setSelected({})
      setLoadStatus({ kind: 'loaded', source: file.name })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setLoadStatus({ kind: 'error', message })
    }
  }

  function toggle(opId: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [opId]: checked }))
  }

  function setVisibleChecked(checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      for (const op of visibleOperations) next[op.id] = checked
      return next
    })
  }

  function onExport() {
    if (!doc) return
    const chosen = operations.filter((op) => selected[op.id])
    const txt = buildExportText(doc, chosen)
    setExportText(txt)
  }

  async function onCopy() {
    await navigator.clipboard.writeText(exportText)
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
      <h1 style={{ margin: '4px 0 16px', fontSize: 22 }}>API Picker</h1>
      <section style={{ ...cardStyle, background: '#f9fafb', marginBottom: 12 }}>
        <div style={{ color: '#111827', fontWeight: 600, fontSize: 13 }}>说明</div>
        <div style={{ marginTop: 6, color: '#374151', fontSize: 13, lineHeight: 1.6 }}>
          此工具导入 Swagger 的 JSON 文件，可以选择指定的 API 后导出为文本文件，再喂给 AI 实现前后端的对接。
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <section style={cardStyle}>
          <div style={loadGridStyle}>
            <div style={loadBoxStyle}>
              <div style={loadBoxTitleStyle}>从文件导入</div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <label style={filePickerStyle}>
                  <input
                    type="file"
                    accept="application/json,.json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void loadByFile(f)
                      e.currentTarget.value = ''
                    }}
                  />
                  <span style={filePickerButtonStyle}>选择 JSON 文件</span>
                </label>
                <span style={filePickerNameStyle} title={fileName}>
                  {fileName}
                </span>
              </div>
            </div>

            <div style={loadBoxStyle}>
              <div style={loadBoxTitleStyle}>从 URL 加载</div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="输入 OpenAPI JSON 的 URL"
                  style={{ ...inputStyle, flex: 1, minWidth: 260 }}
                />
                <button onClick={loadByUrl} style={btnSecondary}>
                  加载 URL
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, color: '#6b7280', fontSize: 13 }}>
            {loadStatus.kind === 'idle' && '未加载数据'}
            {loadStatus.kind === 'loading' && '加载中...'}
            {loadStatus.kind === 'loaded' && `已加载: ${loadStatus.source}（共 ${operations.length} 个 API）`}
            {loadStatus.kind === 'error' && `加载失败: ${loadStatus.message}`}
          </div>
        </section>

        <section style={{ ...cardStyle, padding: 0 }}>
          <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 path / method / summary / tag"
              style={{ ...inputStyle, flex: 1, minWidth: 260 }}
            />
            <button disabled={!doc} onClick={() => setVisibleChecked(true)} style={btnSecondary}>
              当前结果全选
            </button>
            <button disabled={!doc} onClick={() => setVisibleChecked(false)} style={btnSecondary}>
              当前结果全不选
            </button>
            <button disabled={!doc || selectedCount === 0} onClick={onExport} style={btnPrimary}>
              导出（已选 {selectedCount}）
            </button>
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', maxHeight: 420, overflow: 'auto' }}>
            {!doc ? (
              <div style={{ padding: 12, color: '#6b7280' }}>先加载一个 OpenAPI JSON</div>
            ) : visibleOperations.length === 0 ? (
              <div style={{ padding: 12, color: '#6b7280' }}>没有匹配结果</div>
            ) : (
              visibleOperations.map((op) => (
                <label
                  key={op.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 80px 1fr',
                    gap: 10,
                    padding: '10px 12px',
                    alignItems: 'center',
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selected[op.id])}
                    onChange={(e) => toggle(op.id, e.target.checked)}
                  />
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                    {op.method.toUpperCase()}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
                      {op.path}
                    </span>
                    <span style={{ color: '#6b7280', fontSize: 13 }}>
                      {(op.tags?.[0] ?? '') + (op.summary ? ` / ${op.summary}` : '')}
                    </span>
                  </div>
                </label>
              ))
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ color: '#374151' }}>导出文本</div>
            <button disabled={!exportText} onClick={() => void onCopy()} style={btnSecondary}>
              复制
            </button>
            <button disabled={!exportText} onClick={() => setExportText('')} style={btnSecondary}>
              清空
            </button>
          </div>
          <textarea
            value={exportText}
            onChange={(e) => setExportText(e.target.value)}
            placeholder="选择 API 后点击导出"
            style={{
              marginTop: 10,
              width: '100%',
              minHeight: 260,
              resize: 'vertical',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 12,
              background: '#fff',
            }}
          />
        </section>
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 12,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}

const btnBase: CSSProperties = {
  border: '1px solid transparent',
  borderRadius: 10,
  padding: '8px 12px',
  cursor: 'pointer',
}

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: '#111827',
  color: '#fff',
}

const btnSecondary: CSSProperties = {
  ...btnBase,
  background: '#f3f4f6',
  color: '#111827',
  borderColor: '#e5e7eb',
}

const inputStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  outline: 'none',
  background: '#fff',
}

const filePickerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'pointer',
}

const filePickerButtonStyle: CSSProperties = {
  ...btnSecondary,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 36,
}

const filePickerNameStyle: CSSProperties = {
  maxWidth: 420,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#374151',
  fontSize: 13,
  border: '1px solid #e5e7eb',
  background: '#fff',
  padding: '7px 10px',
  borderRadius: 10,
}

const loadGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
}

const loadBoxStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 12,
  background: '#f9fafb',
}

const loadBoxTitleStyle: CSSProperties = {
  fontSize: 13,
  color: '#111827',
  fontWeight: 600,
}
