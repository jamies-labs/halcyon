import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry, type ModelContextHost, type HostRegistration } from '../../src/webmcp/registry';
import type { InvokeRecord, ToolDef } from '../../src/webmcp/types';

function makeFakeHost() {
  const registered = new Map<string, { tool: any; aborted: boolean }>();
  const host: ModelContextHost = {
    register(tool) {
      const entry = { tool, aborted: false };
      registered.set(tool.name, entry);
      const reg: HostRegistration = { abort: () => { entry.aborted = true; registered.delete(tool.name); } };
      return reg;
    },
  };
  return { host, registered };
}

const okTool = (name: string, extra: Partial<ToolDef> = {}): ToolDef => ({
  name, description: `${name} desc`,
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  execute: () => ({ ok: true, data: { name } }),
  ...extra,
});

describe('ToolRegistry', () => {
  let records: InvokeRecord[];
  beforeEach(() => { records = []; });

  it('setTools registers new tools on the host and unregisters removed ones', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, (r) => records.push(r));
    reg.setTools([okTool('a'), okTool('b')]);
    expect([...registered.keys()].sort()).toEqual(['a', 'b']);
    reg.setTools([okTool('b'), okTool('c')]);
    expect([...registered.keys()].sort()).toEqual(['b', 'c']);
  });

  it('setTools leaves unchanged names untouched (no churn)', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a')]);
    const first = registered.get('a');
    reg.setTools([okTool('a'), okTool('b')]);
    expect(registered.get('a')).toBe(first);
  });

  it('addTools merges without dropping live tools', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a')]);
    reg.addTools([okTool('b')]);
    expect([...registered.keys()].sort()).toEqual(['a', 'b']);
  });

  it('invoke validates args and returns a coaching error without calling execute', async () => {
    const execute = vi.fn(() => ({ ok: true as const, data: null }));
    const reg = new ToolRegistry(null, (r) => records.push(r));
    reg.setTools([okTool('strict', {
      inputSchema: { type: 'object', required: ['x'], additionalProperties: false, properties: { x: { type: 'integer' } } },
      execute,
    })]);
    const rec = await reg.invoke('strict', { y: 1 });
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('INVALID_ARGS');
    expect(execute).not.toHaveBeenCalled();
  });

  it('invoke on an unknown tool returns UNKNOWN_TOOL', async () => {
    const reg = new ToolRegistry(null, () => {});
    const rec = await reg.invoke('ghost', {});
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('UNKNOWN_TOOL');
  });

  it('rate-limits repeat calls with retry_after_ms', async () => {
    vi.useFakeTimers();
    const reg = new ToolRegistry(null, () => {});
    reg.setTools([okTool('slow', { rateLimitMs: 1000 })]);
    const first = await reg.invoke('slow', {});
    expect(first.outcome.ok).toBe(true);
    const second = await reg.invoke('slow', {});
    expect(second.outcome.ok).toBe(false);
    if (!second.outcome.ok) {
      expect(second.outcome.code).toBe('RATE_LIMITED');
      expect(second.outcome.retry_after_ms).toBeGreaterThan(0);
    }
    vi.advanceTimersByTime(1100);
    const third = await reg.invoke('slow', {});
    expect(third.outcome.ok).toBe(true);
    vi.useRealTimers();
  });

  it('records every invoke with monotonic seq and source', async () => {
    const reg = new ToolRegistry(null, (r) => records.push(r));
    reg.setTools([okTool('a')]);
    await reg.invoke('a', {}, 'sim');
    await reg.invoke('a', {}, 'agent');
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect(records.map((r) => r.source)).toEqual(['sim', 'agent']);
  });

  it('an execute that throws becomes TOOL_CRASH, never an unhandled rejection', async () => {
    const reg = new ToolRegistry(null, () => {});
    reg.setTools([okTool('boom', { execute: () => { throw new Error('kaput'); } })]);
    const rec = await reg.invoke('boom', {});
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('TOOL_CRASH');
  });

  it('host execute path returns MCP content with JSON payload and isError on failure', async () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a'), okTool('bad', { execute: () => ({ ok: false, code: 'X', detail: 'd', hint: 'h' }) })]);
    const good = await registered.get('a')!.tool.execute({});
    expect(JSON.parse(good.content[0].text).ok).toBe(true);
    expect(good.isError).toBeUndefined();
    const bad = await registered.get('bad')!.tool.execute({});
    expect(JSON.parse(bad.content[0].text).code).toBe('X');
    expect(bad.isError).toBe(true);
  });

  it('maps readOnly to annotations.readOnlyHint on the host descriptor', () => {
    const { registered, host } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('r', { readOnly: true })]);
    expect(registered.get('r')!.tool.annotations).toEqual({ readOnlyHint: true });
  });
});
