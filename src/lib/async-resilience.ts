export class RequestTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} demorou mais que o esperado`);
    this.name = "RequestTimeoutError";
  }
}

/** Impede que uma chamada de rede deixe a navegação ou um botão presos para sempre. */
export async function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs = 10_000,
  label = "A conexão",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RequestTimeoutError(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}