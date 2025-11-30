# Best Practices

## Coding Best Practices

### Code Architecture

#### 1. Follow SOLID Principles

Apply [SOLID principles](https://en.wikipedia.org/wiki/SOLID) throughout the codebase. There are a few [React specific SOLID principles](https://dev.to/drruvari/mastering-solid-principles-in-react-easy-examples-and-best-practices-142b) and [articles](https://medium.com/@ignatovich.dm/applying-solid-principles-in-react-applications-44eda5e4b664) that are worth following.

#### 2. Use Readonly Types for Pure Functions

Prevent accidental mutations with `ReadonlySet<string>` and `readonly string[]`:

```typescript
function sanitizeFileNames(
  fileNames: ReadonlySet<string> // Cannot be mutated
): string;
```

**Benefits:** Compile-time safety, clear intent, reduced bugs.

#### 3. Avoid Barrel Files (index.ts)

Use direct imports to prevent circular dependencies and improve tree shaking:

```typescript
// ✅ Good: Direct imports
import { foo } from "./utils/barUtil";

// ❌ Avoid: export * from './utils/';
```

**Benefits:** Clear dependencies, faster compilation, easier refactoring.

### 4. Error Handling: Follow typed error patterns for domain-specific errors

Create custom error classes with unique error codes for programmatic identification:

```typescript
// 1. Define error code, preferably in src/shared/models/errors/error-code.ts
export const DataProcessingErrorCode = "123456";

// 2. Create error class extending Error
export class DataProcessingError extends Error {
  readonly code: string;

  constructor(
    operation: string,
    public readonly fileName?: string, // Additional machine-readable fields
    cause?: string
  ) {
    super(`Data processing failed during ${operation}: ${cause}`);
    this.code = DataProcessingErrorCode;
  }
}

// 3. Use error codes for programmatic identification (survives serialization)
try {
  await processData();
} catch (error) {
  if ((error as any).code === DataProcessingErrorCode) {
    // Handle specific error type without relying on polymorphism
    const processingError = error as DataProcessingError;
    showUserFriendlyMessage(processingError.fileName);
  }
}
```

**Key Principles:**

- **Unique Error Codes**: Enable programmatic error type identification without polymorphism
- **Extend Error**: Follow standard JavaScript error patterns
- **Additional Fields**: Include machine-consumable context (filenames, asset IDs, etc.)
- **Serialization-Safe**: Error codes work across network boundaries and JSON serialization

Here's a concise way you could write that best practice:

---

### 5. Prefer an options object for functions with 3+ parameters

When a function needs **three or more parameters**, define a dedicated **options object type** instead of using multiple positional parameters.

- Name the type `FunctionNameOptions` (for example, `loadUserOptions`).
- The function should accept a **single** `options` parameter.
- Inside the function body, use **destructuring assignment** to pull out the fields you need.

This pattern:

1. Makes arguments **self-documenting at the call site** (parameter names are visible where the function is called).
2. Prevents bugs from **incorrect parameter ordering**.
3. Makes it **easy to add, remove, or mark parameters optional** without breaking existing call sites.

**Example**:

```typescript
// ✅ Good

interface GetApplicationUserOptions {
  appId: string;
  userId: string;
  ignoreInactiveUser?: boolean;
}

function getApplicationUser(options: Readonly<GetApplicationUserOptions>) {
  const { appId, userId, ignoreInactiveUser } = options;
  // ...
}

// ❌ Bad: comparing more than one results
function getApplicationUser(
  appId: string,
  userId: string,
  ignoreInactiveUser?: boolean
) {
  // ...
}

// Call site
getApplicationUser("user-456", "app-123", true); // No compiler error, but it's not clear what the options are, hard to spot bugs
```

Benefits:

- **You don't care about parameter order anymore.** Adding fields doesn't break existing ones.
- You can add **optional properties** freely (`foo?: string`) without changing any existing call sites.
- IDEs will autocomplete the property names for you, making it harder to miss something.

## Testing Best Practices

### 1. One Assertion Per Test

Each test validates exactly one behavior for precise failure diagnosis:

```typescript
// ✅ Good: Specific, focused tests

let validateResult: { isValid: boolean; sanitizedKey: string };
beforeEach(() => {
  validateResult = validateColumnNameInput("123Col");
});

it("123Col should be invalid because it starts with numbers", () => {
  expect(validateResult.isValid).toBe(false);
});

it('A sanitized 123Col should be "Col" by stripping the numbers prefix', () => {
  expect(validateResult.sanitizedKey).toBe("Col");
});

// ❌ Bad: comparing more than one results
it("should return expected result", () => {
  // When it fails, there is little information about what went wrong.
  expect(validateColumnNameInput("123Col")).toBe({
    isValid: false,
    sanitizedKey: "Col",
  });
});
```

### 2. Keep tests DRY with `it.each`

Put your inputs and expected outputs into a small table of objects and run the same test logic over each row:

```typescript
it.each([
  { label: "abc", expected: "abc" },
  { label: "camelCase", expected: "camelCase" },
  { label: "$$col", expected: "col" },
  { label: "123Col", expected: "Col" },
])('sanitizes $label → "$expected"', ({ label, expected }) => {
  expect(sanitizeColumnKey(label)).toBe(expected);
});
```

Benefits:

- **No copy-paste:** one test body, many cases.
- **Easy to extend:** add a new case by adding one more object.
- **Clear intent:** the data table shows all covered scenarios in one place.

## Best Practices Checklist

When implementing new or refactoring existing functionality:

- [ ] **Single Responsibility**: Each function has one clear purpose
- [ ] **Readonly Types**: Use `readonly` for parameters that shouldn't be mutated
- [ ] **No Barrel Files**: Import directly from source files
- [ ] **Options Object Pattern**: Use an options object for functions with 3+ parameters
- [ ] **Extract Constants**: Move magic values to named configuration objects
- [ ] **Error Handling**: Follow typed error patterns for domain-specific errors
- [ ] **One Assertion Per Test**: Each test validates exactly one behavior
- [ ] **Parameterized Testing**: Use `it.each` for systematic coverage
- [ ] **Self-Documenting Code**: Clear function names and minimal comments
- [ ] **No redundant JSDoc comments**: No JSDoc is needed on function or constant names that are self-explanatory
