type JsonSchema = Record<string, unknown>

export type SchemaValidationResult =
  | { ok: true }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}

function validateType(
  expectedType: string,
  value: unknown,
  path: string,
): string | undefined {
  switch (expectedType) {
    case 'object':
      return isPlainObject(value)
        ? undefined
        : `${path} should be an object, got ${describeValue(value)}`
    case 'array':
      return Array.isArray(value)
        ? undefined
        : `${path} should be an array, got ${describeValue(value)}`
    case 'string':
      return typeof value === 'string'
        ? undefined
        : `${path} should be a string, got ${describeValue(value)}`
    case 'boolean':
      return typeof value === 'boolean'
        ? undefined
        : `${path} should be a boolean, got ${describeValue(value)}`
    case 'integer':
      return Number.isInteger(value)
        ? undefined
        : `${path} should be an integer, got ${describeValue(value)}`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `${path} should be a number, got ${describeValue(value)}`
    case 'null':
      return value === null
        ? undefined
        : `${path} should be null, got ${describeValue(value)}`
    default:
      return undefined
  }
}

function validateSchemaAtPath(
  value: unknown,
  schema: JsonSchema,
  path: string,
): string | undefined {
  const anyOf = schema.anyOf
  if (Array.isArray(anyOf)) {
    const branchErrors = anyOf
      .filter(isPlainObject)
      .map(branch => validateSchemaAtPath(value, branch, path))
      .filter((error): error is string => typeof error === 'string')

    if (branchErrors.length < anyOf.length) {
      return undefined
    }

    return `${path} did not match any allowed schema`
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(option => option === value)) {
    return `${path} should be one of ${schema.enum
      .map(option => JSON.stringify(option))
      .join(', ')}`
  }

  if (typeof schema.type === 'string') {
    const typeError = validateType(schema.type, value, path)
    if (typeError) {
      return typeError
    }
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : []

    for (const key of required) {
      if (!(key in value) || value[key] === undefined) {
        return `${path}.${key} is required`
      }
    }

    const properties = isPlainObject(schema.properties)
      ? schema.properties
      : undefined

    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (
          !(key in value) ||
          value[key] === undefined ||
          !isPlainObject(propertySchema)
        ) {
          continue
        }

        const propertyError = validateSchemaAtPath(
          value[key],
          propertySchema,
          `${path}.${key}`,
        )
        if (propertyError) {
          return propertyError
        }
      }
    }

    const additionalProperties = schema.additionalProperties
    if (additionalProperties !== undefined) {
      for (const [key, propertyValue] of Object.entries(value)) {
        if (propertyValue === undefined) {
          continue
        }

        if (properties && key in properties) {
          continue
        }

        if (additionalProperties === false) {
          return `${path}.${key} is not allowed`
        }

        if (isPlainObject(additionalProperties)) {
          const propertyError = validateSchemaAtPath(
            propertyValue,
            additionalProperties,
            `${path}.${key}`,
          )
          if (propertyError) {
            return propertyError
          }
        }
      }
    }
  }

  if (Array.isArray(value) && isPlainObject(schema.items)) {
    for (const [index, item] of value.entries()) {
      const itemError = validateSchemaAtPath(item, schema.items, `${path}[${index}]`)
      if (itemError) {
        return itemError
      }
    }
  }

  return undefined
}

export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown> | undefined,
): SchemaValidationResult {
  if (!schema) {
    return { ok: true }
  }

  const error = validateSchemaAtPath(value, schema, '$')
  return error ? { ok: false, error } : { ok: true }
}
