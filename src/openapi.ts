export type OpenApiDocument = {
  openapi?: string
  swagger?: string
  info?: { title?: string; version?: string }
  servers?: Array<{ url?: string }>
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, OpenApiSchema> }
  definitions?: Record<string, OpenApiSchema>
}

export type OpenApiSchema = {
  $ref?: string
  type?: string
  format?: string
  description?: string
  title?: string
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchema
  allOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  oneOf?: OpenApiSchema[]
  additionalProperties?: boolean | OpenApiSchema
}

type OpenApiParameter = {
  name?: string
  in?: string
  required?: boolean
  description?: string
  schema?: OpenApiSchema
  type?: string
  format?: string
  items?: OpenApiSchema
}

type OpenApiRequestBody = {
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchema }>
}

type OpenApiResponse = {
  description?: string
  content?: Record<string, { schema?: OpenApiSchema }>
  schema?: OpenApiSchema
}

type OpenApiOperationObject = {
  tags?: string[]
  summary?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
}

export type ApiOperation = {
  id: string
  path: string
  method: string
  tags?: string[]
  summary?: string
  operation: OpenApiOperationObject
}

export type FieldInfo = {
  name: string
  type: string
  required: boolean
  description?: string
}

const httpMethods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'])

export function buildOperations(doc: OpenApiDocument): ApiOperation[] {
  const paths = doc.paths ?? {}
  const out: ApiOperation[] = []
  for (const [pathKey, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue
    for (const [method, opUnknown] of Object.entries(methods as Record<string, unknown>)) {
      if (!httpMethods.has(method.toLowerCase())) continue
      const operation = opUnknown as OpenApiOperationObject
      const id = operation.operationId ? `${method}:${pathKey}:${operation.operationId}` : `${method}:${pathKey}`
      out.push({
        id,
        path: pathKey,
        method: method.toLowerCase(),
        tags: operation.tags,
        summary: operation.summary,
        operation,
      })
    }
  }
  out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)))
  return out
}

export function buildExportText(doc: OpenApiDocument, ops: ApiOperation[]): string {
  if (ops.length === 0) return ''
  const lines: string[] = []
  for (const op of ops) {
    lines.push(`[${op.method.toUpperCase()}] ${op.path}`)
    if (op.summary) lines.push(`摘要: ${op.summary}`)
    if (op.tags?.length) lines.push(`标签: ${op.tags.join(', ')}`)

    const reqLines = buildRequestLines(doc, op.operation)
    lines.push('请求参数:')
    if (reqLines.length === 0) lines.push('- 无')
    else for (const l of reqLines) lines.push(l)

    const respLines = buildResponseLines(doc, op.operation)
    lines.push('响应参数:')
    if (respLines.length === 0) lines.push('- 无')
    else for (const l of respLines) lines.push(l)

    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function buildRequestLines(doc: OpenApiDocument, op: OpenApiOperationObject): string[] {
  const lines: string[] = []

  const params = op.parameters ?? []
  const groups: Record<string, OpenApiParameter[]> = {}
  for (const p of params) {
    const key = p.in ?? 'unknown'
    groups[key] = groups[key] ?? []
    groups[key].push(p)
  }

  for (const key of Object.keys(groups).sort()) {
    lines.push(`- ${key}:`)
    for (const p of groups[key]) {
      const name = p.name ?? '(unnamed)'
      const required = Boolean(p.required)
      const schema = normalizeParameterSchema(p)
      const typeText = schemaToTypeText(doc, schema)
      const desc = p.description ? ` ${p.description}` : ''
      lines.push(`  - ${name}: ${typeText}${required ? ' (必填)' : ''}${desc}`)
    }
  }

  const bodySchema = extractRequestBodySchema(op)
  if (bodySchema) {
    const fields = flattenSchemaFields(doc, bodySchema)
    lines.push('- body:')
    if (fields.length === 0) {
      lines.push(`  - ${schemaToTypeText(doc, bodySchema)}`)
    } else {
      for (const f of fields) {
        lines.push(`  - ${f.name}: ${f.type}${f.required ? ' (必填)' : ''}${f.description ? ` ${f.description}` : ''}`)
      }
    }
  }

  return lines
}

function buildResponseLines(doc: OpenApiDocument, op: OpenApiOperationObject): string[] {
  const responses = op.responses ?? {}
  const preferred = responses['200'] ?? responses['201'] ?? responses['default'] ?? firstResponse(responses)
  if (!preferred) return []

  const schema = extractResponseSchema(preferred)
  if (!schema) return []

  const fields = flattenSchemaFields(doc, schema)
  if (fields.length === 0) return [`- ${schemaToTypeText(doc, schema)}`]
  return fields.map((f) => `- ${f.name}: ${f.type}${f.required ? ' (必填)' : ''}${f.description ? ` ${f.description}` : ''}`)
}

function firstResponse(responses: Record<string, OpenApiResponse>): OpenApiResponse | undefined {
  const keys = Object.keys(responses)
  if (keys.length === 0) return undefined
  return responses[keys[0]]
}

function extractRequestBodySchema(op: OpenApiOperationObject): OpenApiSchema | undefined {
  const rb = op.requestBody
  if (!rb) return undefined
  const content = rb.content ?? {}
  const json = content['application/json'] ?? content['*/*'] ?? content['application/*+json']
  return json?.schema
}

function extractResponseSchema(resp: OpenApiResponse): OpenApiSchema | undefined {
  const content = resp.content ?? {}
  const json = content['application/json'] ?? content['*/*'] ?? content['application/*+json']
  if (json?.schema) return json.schema
  if (resp.schema) return resp.schema
  return undefined
}

function normalizeParameterSchema(p: OpenApiParameter): OpenApiSchema | undefined {
  if (p.schema) return p.schema
  if (p.type) {
    return {
      type: p.type,
      format: p.format,
      items: p.items,
    }
  }
  return undefined
}

function schemaToTypeText(doc: OpenApiDocument, schema?: OpenApiSchema): string {
  const s = schema ? resolveSchema(doc, schema) : undefined
  if (!s) return 'unknown'
  const type = s.type
  if (!type) {
    if (s.allOf?.length) return s.allOf.map((x) => schemaToTypeText(doc, x)).join(' & ')
    if (s.oneOf?.length) return s.oneOf.map((x) => schemaToTypeText(doc, x)).join(' | ')
    if (s.anyOf?.length) return s.anyOf.map((x) => schemaToTypeText(doc, x)).join(' | ')
    if (s.properties) return 'object'
    if (s.$ref) return refToName(s.$ref)
    return 'unknown'
  }
  if (type === 'integer' && (s.format === 'int64' || s.format === 'uint64')) return 'string'
  if (type === 'array') return `${schemaToTypeText(doc, s.items)}[]`
  if (type === 'object') {
    if (typeof s.additionalProperties === 'object') return `Record<string, ${schemaToTypeText(doc, s.additionalProperties)}>`
    return 'object'
  }
  if (type === 'string' && Array.isArray(s.enum) && s.enum.length) return `string(enum: ${s.enum.map(String).join(', ')})`
  return s.format ? `${type}(${s.format})` : type
}

function flattenSchemaFields(doc: OpenApiDocument, schema: OpenApiSchema): FieldInfo[] {
  const resolved = resolveSchema(doc, schema)
  const out: FieldInfo[] = []
  const visited = new Set<string>()
  walkSchema(doc, resolved, '', true, out, visited)
  return out
}

function walkSchema(
  doc: OpenApiDocument,
  schema: OpenApiSchema | undefined,
  prefix: string,
  parentRequired: boolean,
  out: FieldInfo[],
  visitedRefs: Set<string>,
) {
  if (!schema) return
  if (schema.$ref) {
    const ref = schema.$ref
    if (visitedRefs.has(ref)) return
    visitedRefs.add(ref)
    const resolved = resolveSchema(doc, schema)
    walkSchema(doc, resolved, prefix, parentRequired, out, visitedRefs)
    return
  }

  if (schema.allOf?.length) {
    for (const part of schema.allOf) walkSchema(doc, resolveSchema(doc, part), prefix, parentRequired, out, visitedRefs)
    return
  }

  if (schema.oneOf?.length || schema.anyOf?.length) {
    const union = schema.oneOf ?? schema.anyOf ?? []
    const type = union.map((u) => schemaToTypeText(doc, u)).join(' | ')
    out.push({ name: prefix || '(root)', type, required: parentRequired, description: schema.description })
    return
  }

  const type = schema.type
  if (type === 'object' || (!type && schema.properties)) {
    const requiredSet = new Set(schema.required ?? [])
    const props = schema.properties ?? {}
    const propEntries = Object.entries(props)
    if (propEntries.length === 0) {
      out.push({
        name: prefix || '(root)',
        type: schemaToTypeText(doc, schema),
        required: parentRequired,
        description: schema.description,
      })
      return
    }

    for (const [key, child] of propEntries) {
      const childPrefix = prefix ? `${prefix}.${key}` : key
      const required = parentRequired && requiredSet.has(key)
      const resolvedChild = resolveSchema(doc, child)
      const isLeaf = !resolvedChild.$ref && !resolvedChild.properties && resolvedChild.type !== 'object' && resolvedChild.type !== 'array'
      if (isLeaf) {
        out.push({
          name: childPrefix,
          type: schemaToTypeText(doc, resolvedChild),
          required,
          description: resolvedChild.description,
        })
      } else if (resolvedChild.type === 'array') {
        out.push({
          name: childPrefix,
          type: schemaToTypeText(doc, resolvedChild),
          required,
          description: resolvedChild.description,
        })
      } else {
        walkSchema(doc, resolvedChild, childPrefix, required, out, visitedRefs)
      }
    }
    return
  }

  out.push({
    name: prefix || '(root)',
    type: schemaToTypeText(doc, schema),
    required: parentRequired,
    description: schema.description,
  })
}

function resolveSchema(doc: OpenApiDocument, schema: OpenApiSchema): OpenApiSchema {
  if (!schema.$ref) return schema
  const ref = schema.$ref
  const direct = resolveRef(doc, ref)
  if (!direct) return schema
  const merged: OpenApiSchema = { ...direct, ...schema }
  delete merged.$ref
  return merged
}

function resolveRef(doc: OpenApiDocument, ref: string): OpenApiSchema | undefined {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref.slice(2).split('/')
  const root = doc as unknown as Record<string, unknown>
  let cur: unknown = root
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  if (!cur || typeof cur !== 'object') return undefined
  return cur as OpenApiSchema
}

function refToName(ref: string): string {
  const idx = ref.lastIndexOf('/')
  return idx >= 0 ? ref.slice(idx + 1) : ref
}

