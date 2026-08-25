type Schema = Record<string, unknown>;
type Result = { ok: true } | { ok: false; detail: string };

function fail(detail: string): Result { return { ok: false, detail }; }

export function validateArgs(schema: Schema, value: unknown, path = 'args'): Result {
  const type = schema.type as string | undefined;
  if (schema.enum) {
    const allowed = schema.enum as unknown[];
    if (!allowed.includes(value)) return fail(`${path} must be one of ${JSON.stringify(allowed)}`);
  }
  switch (type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return fail(`${path} must be an object`);
      const obj = value as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required as string[] | undefined) ?? [])
        if (!(key in obj)) return fail(`${path}.${key} is required`);
      if (schema.additionalProperties === false)
        for (const key of Object.keys(obj))
          if (!(key in props)) return fail(`${path}.${key} is not a recognized field`);
      for (const [key, sub] of Object.entries(props))
        if (key in obj) {
          const r = validateArgs(sub, obj[key], `${path}.${key}`);
          if (!r.ok) return r;
        }
      return { ok: true };
    }
    case 'array': {
      if (!Array.isArray(value)) return fail(`${path} must be an array`);
      const min = schema.minItems as number | undefined;
      const max = schema.maxItems as number | undefined;
      if (min !== undefined && value.length < min) return fail(`${path} needs at least ${min} items`);
      if (max !== undefined && value.length > max) return fail(`${path} allows at most ${max} items`);
      const items = schema.items as Schema | undefined;
      if (items)
        for (let i = 0; i < value.length; i++) {
          const r = validateArgs(items, value[i], `${path}[${i}]`);
          if (!r.ok) return r;
        }
      return { ok: true };
    }
    case 'string': {
      if (typeof value !== 'string') return fail(`${path} must be a string`);
      const minL = schema.minLength as number | undefined;
      const maxL = schema.maxLength as number | undefined;
      if (minL !== undefined && value.length < minL) return fail(`${path} must be at least ${minL} chars`);
      if (maxL !== undefined && value.length > maxL) return fail(`${path} must be at most ${maxL} chars`);
      return { ok: true };
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return fail(`${path} must be a number`);
      if (type === 'integer' && !Number.isInteger(value)) return fail(`${path} must be an integer`);
      const min = schema.minimum as number | undefined;
      const max = schema.maximum as number | undefined;
      if (min !== undefined && value < min) return fail(`${path} must be >= ${min}`);
      if (max !== undefined && value > max) return fail(`${path} must be <= ${max}`);
      return { ok: true };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true } : fail(`${path} must be a boolean`);
    case undefined:
      return { ok: true };
    default:
      return fail(`${path}: unsupported schema type "${type}"`);
  }
}
