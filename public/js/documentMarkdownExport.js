const YAML_QUOTE_TRIGGER = /[:"\\\n#\r\t]|^[\-?!&*{}\[\],>|%@`']|^\s|\s$/

function yamlString(value) {
  const str = String(value ?? '')
  if (str === '') return '""'
  if (!YAML_QUOTE_TRIGGER.test(str) && !/^(?:null|true|false|yes|no|on|off|~|[-+]?(?:\d.*|\.\d.*|\.inf)|\.nan)$/i.test(str)) return str
  return JSON.stringify(str)
}

function renderLinksBlock(links) {
  const groups = links || { 'derived-from': [], supersedes: [] }
  const relationOrder = ['derived-from', 'supersedes']
  const lines = ['links:']
  for (const relation of relationOrder) {
    const entries = Array.isArray(groups[relation]) ? groups[relation] : []
    if (entries.length === 0) {
      lines.push(`  ${relation}: []`)
      continue
    }
    lines.push(`  ${relation}:`)
    for (const entry of entries) {
      lines.push(`    - id: ${entry.id}`)
      lines.push(`      ref: ${yamlString(entry.ref || '')}`)
      if (entry.targetHash !== undefined) lines.push(`      target_hash: ${JSON.stringify(entry.targetHash)}`)
    }
  }
  return lines.join('\n')
}

export function formatFrontMatter(doc, projectSlug, links) {
  const tags = Array.isArray(doc.tags) ? doc.tags : []
  const tagsBlock = tags.length === 0
    ? 'tags: []'
    : `tags:\n${tags.map(tag => `  - ${yamlString(tag)}`).join('\n')}`
  const slug = projectSlug && String(projectSlug).trim() ? String(projectSlug) : 'unknown'
  const linksBlock = renderLinksBlock(links)

  return [
    '---',
    `title: ${yamlString(doc.title || '')}`,
    `type: ${yamlString(doc.documentType || 'note')}`,
    `project: ${yamlString(slug)}`,
    tagsBlock,
    `created_at: ${doc.createdAt || ''}`,
    `updated_at: ${doc.updatedAt || ''}`,
    `kind: ${doc.kind || 'source'}`,
    `content_hash: ${doc.contentHash || ''}`,
    `updated_by: ${doc.updatedBy || 'user'}`,
    'prax_export_version: 3',
    `id: ${JSON.stringify(doc.id ?? null)}`,
    `status: ${JSON.stringify(doc.status || 'active')}`,
    `archived_at: ${JSON.stringify(doc.archivedAt ?? null)}`,
    `verified: ${Boolean(doc.verified)}`,
    `verified_at: ${JSON.stringify(doc.verifiedAt ?? null)}`,
    `verified_by: ${JSON.stringify(doc.verifiedBy ?? null)}`,
    `updated_by_agent: ${JSON.stringify(doc.updatedByAgent ?? null)}`,
    `source_filename: ${JSON.stringify(doc.sourceFilename ?? null)}`,
    `external_refs: ${JSON.stringify(doc.externalRefs || [])}`,
    `code_refs: ${JSON.stringify(doc.codeRefs || [])}`,
    `task_ids: ${JSON.stringify(doc.taskIds || [])}`,
    linksBlock,
    '---',
    '',
  ].join('\n')
}

export function renderDocumentMarkdown(doc, projectSlug, links) {
  const frontMatter = formatFrontMatter(doc, projectSlug, links)
  const body = String(doc.body ?? '')
  if (body === '') return frontMatter
  const bodyWithNewline = body.endsWith('\n') ? body : `${body}\n`
  return `${frontMatter}\n${bodyWithNewline}`
}

