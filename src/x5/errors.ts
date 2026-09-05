export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class X5AuthenticationError extends AppError {
  constructor() { super('X5_AUTH', 'Сессия X5 недействительна. Войдите в X5 Club и обновите X5_COOKIE в .env, затем перезапустите сервер.'); }
}
export class X5RequestError extends AppError {
  constructor() { super('X5_REQUEST', 'Не удалось получить ответ X5. Проверьте подключение и повторите запрос.'); }
}
export class X5DecodeError extends AppError {
  constructor() { super('X5_DECODE', 'Не удалось декодировать ответ X5. Формат API мог измениться.'); }
}
export class X5RateLimitError extends AppError {
  constructor() { super('X5_RATE_LIMIT', 'X5 ограничил частоту запросов. Подождите и повторите синхронизацию позже.'); }
}
export class X5UnexpectedResponseError extends AppError {
  constructor() { super('X5_UNEXPECTED_RESPONSE', 'Ответ X5 не содержит ожидаемую историю чеков. Проверьте сессию и совместимость формата API.'); }
}
export function safeError(error: unknown): { code: string; message: string } {
  // Never serialize arbitrary errors, response bodies, headers, or Zod input values.
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'Операция не выполнена. Проверьте настройки и доступ к локальной базе.' };
}
