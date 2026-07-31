import { describe, it, expect } from 'vitest'
import { parseAssistantMessageV2, normalizeToolCallFormat } from '../parse-assistant-message'
import type { ToolUse, TextContent } from '..'

describe('normalizeToolCallFormat', () => {
  it('returns plain text unchanged (fast path)', () => {
    const msg = 'Just some explanation text with <b>html</b> and read_file mention.'
    expect(normalizeToolCallFormat(msg)).toBe(msg)
  })

  it('returns canonical tool calls unchanged', () => {
    const msg = '<read_file>\n<path>foo.txt</path>\n</read_file>'
    expect(normalizeToolCallFormat(msg)).toBe(msg)
  })

  it('rewrites MiMo/Qwen style tool_call markup into canonical form', () => {
    // Exact message shape that dead-locked the serial AI session (2026-07-31)
    const msg =
      '<tool_call>\n<function=read_file>\n<parameter=path>offload/b629e221-7147-41d3-b7b7-5438c4cc4ca4.txt</parameter>\n<parameter=limit>200</parameter>\n<parameter=offset>0</parameter>\n</function>\n</tool_call>'
    const normalized = normalizeToolCallFormat(msg)
    expect(normalized).toContain('<read_file>')
    expect(normalized).toContain('<path>offload/b629e221-7147-41d3-b7b7-5438c4cc4ca4.txt</path>')
    expect(normalized).toContain('<limit>200</limit>')
    expect(normalized).toContain('<offset>0</offset>')
    expect(normalized).toContain('</read_file>')
    expect(normalized).not.toContain('tool_call')
    expect(normalized).not.toContain('function=')
    expect(normalized).not.toContain('parameter=')
  })

  it('preserves surrounding prose text', () => {
    const msg = 'Let me read the output.\n<tool_call>\n<function=read_file>\n<parameter=path>a.txt</parameter>\n</function>\n</tool_call>\nDone.'
    const normalized = normalizeToolCallFormat(msg)
    expect(normalized).toContain('Let me read the output.')
    expect(normalized).toContain('<read_file>')
    expect(normalized).toContain('Done.')
  })

  it('keeps "<" characters inside parameter values verbatim', () => {
    const msg = '<function=execute_command>\n<parameter=command>echo "<hello>" && cat a</parameter>\n</function>'
    const normalized = normalizeToolCallFormat(msg)
    expect(normalized).toContain('<command>echo "<hello>" && cat a</command>')
  })

  it('handles a partially streamed parameter value gracefully', () => {
    const msg = '<tool_call>\n<function=read_file>\n<parameter=path>offload/partial'
    const normalized = normalizeToolCallFormat(msg)
    expect(normalized).toContain('<read_file>')
    expect(normalized).toContain('<path>offload/partial')
  })
})

describe('parseAssistantMessageV2 with alternative tool-call markup', () => {
  it('parses the MiMo-style read_file call into an executable tool_use block', () => {
    const msg =
      '<tool_call>\n<function=read_file>\n<parameter=path>offload/b629e221.txt</parameter>\n<parameter=limit>200</parameter>\n<parameter=offset>0</parameter>\n</function>\n</tool_call>'
    const blocks = parseAssistantMessageV2(msg)
    const tool = blocks.find((b) => b.type === 'tool_use') as ToolUse
    expect(tool).toBeDefined()
    expect(tool.name).toBe('read_file')
    expect(tool.partial).toBe(false)
    expect(tool.params.path).toBe('offload/b629e221.txt')
    expect(tool.params.limit).toBe('200')
    expect(tool.params.offset).toBe('0')
  })

  it('still parses canonical format tool calls', () => {
    const msg = '<read_file>\n<path>foo.txt</path>\n<limit>50</limit>\n</read_file>'
    const blocks = parseAssistantMessageV2(msg)
    const tool = blocks.find((b) => b.type === 'tool_use') as ToolUse
    expect(tool).toBeDefined()
    expect(tool.name).toBe('read_file')
    expect(tool.params.path).toBe('foo.txt')
    expect(tool.params.limit).toBe('50')
  })

  it('keeps prose before the tool call as a text block', () => {
    const msg =
      'I will inspect the offloaded output.\n<tool_call>\n<function=read_file>\n<parameter=path>a.txt</parameter>\n</function>\n</tool_call>'
    const blocks = parseAssistantMessageV2(msg)
    const text = blocks.find((b) => b.type === 'text') as TextContent
    const tool = blocks.find((b) => b.type === 'tool_use') as ToolUse
    expect(text?.content).toContain('I will inspect the offloaded output.')
    expect(tool?.name).toBe('read_file')
    expect(tool?.params.path).toBe('a.txt')
  })

  it('parses MiMo-style execute_command with requires_approval', () => {
    const msg =
      '<tool_call>\n<function=execute_command>\n<parameter=command>display version</parameter>\n<parameter=requires_approval>false</parameter>\n</function>\n</tool_call>'
    const blocks = parseAssistantMessageV2(msg)
    const tool = blocks.find((b) => b.type === 'tool_use') as ToolUse
    expect(tool?.name).toBe('execute_command')
    expect(tool?.params.command).toBe('display version')
    expect(tool?.params.requires_approval).toBe('false')
  })
})
