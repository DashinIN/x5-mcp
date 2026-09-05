# ADR-001: X5 Club Purchase History MCP

Status: **Accepted / MVP**

Date: **2026-09-05**

## 1. Цель

Создать локальный MCP-сервер для доступа к истории покупок X5 Club.

Система должна позволять LLM получать и анализировать:

* чеки;
* даты покупок;
* магазины;
* суммы;
* товары;
* количество товара;
* обычную и фактическую цену;
* скидки;
* PLU товара;
* категории;
* историю изменения цен;
* агрегированные траты.

Примеры будущих запросов:

* «Сколько я потратил в Пятёрочке в августе?»
* «Когда я последний раз покупал этот кофе?»
* «Как менялась цена на этот товар?»
* «Какие товары я покупаю чаще всего?»
* «Сколько денег ушло на молочные продукты за год?»
* «Какие мои регулярно покупаемые товары сильнее всего подорожали?»

---

# 2. Исходные факты

## 2.1. X5 Club использует React Router data routes

История доступна через route:

```text
/lk/history
```

Первоначальная загрузка страницы выполняется через:

```text
GET /lk/history.data?_routes=...
```

Но пагинация истории выполняется отдельным POST.

---

## 2.2. POST истории

Фронтенд вызывает React Router `fetcher.submit`:

```js
fetcher.submit(data, {
    method: "post",
    action: "/lk/history"
});
```

В production network это превращается в:

```http
POST https://x5club.ru/lk/history.data
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
```

Сам вызов `fetcher.submit` с `method: post` и action маршрута `/lk/history` подтверждён JS-бандлом X5 Club.

Реальный payload, полученный через Chrome DevTools:

```text
page=2
&type=receipts
&from=2026-08-01
&to=2026-09-05
&codeTc=D%2CS%2CVK%2CSL%2CVP
```

После URL decoding:

```ts
{
    page: 2,
    type: "receipts",
    from: "2026-08-01",
    to: "2026-09-05",
    codeTc: "D,S,VK,SL,VP"
}
```

Frontend при пагинации увеличивает `page` и повторно передаёт `type`, `from`, `to` и `codeTc`.

---

## 2.3. Типы истории

Frontend использует:

```ts
type HistoryType =
    | "receipts"
    | "points";
```

Для MVP нужен только:

```text
receipts
```

---

## 2.4. Сети

Из production-запроса известны следующие значения:

```text
D
S
VK
SL
VP
```

Из frontend bundle известно, что они соответствуют набору сетей:

```text
Пятёрочка
Перекрёсток
Виктория
Слата
Vprok
```

Frontend действительно разворачивает фильтр «Все» в набор кодов сетей.

Для MVP не следует жёстко полагаться на человекочитаемое значение каждого кода во внутренней бизнес-логике.

Хранить `codeTc` как исходное значение X5.

---

## 2.5. Ответ

Frontend ожидает:

```ts
additionalReceiptsResponse
```

и при пагинации добавляет его элементы к уже загруженным чекам. Пустой массив означает конец данных.

Первичная загрузка истории содержит полноценные чеки с полями вроде:

```text
created
amountPromo
amountRegular
storeAddress
checkNum
fiscalNum
ofdurl
items
```

В `items` присутствуют:

```text
pluId
name
quantity
priceRegular
pricePromo
priceItem
categoryCode
main_photo
```

То есть состав чеков уже доступен через X5 Club.

---

# 3. Архитектурное решение

Использовать архитектуру:

```text
          X5 Club
             │
             ▼
       X5 HTTP Client
             │
             ▼
       Response Decoder
             │
             ▼
         Normalizer
             │
             ▼
          SQLite
             │
             ▼
       Repository layer
             │
             ▼
        MCP server
             │
             ▼
     Codex / ChatGPT / etc.
```

MCP **не должен напрямую заниматься scraping HTTP-ответов X5**.

Ответственности разделяются.

---

# 4. Почему не делать MCP напрямую поверх X5

Отвергнутый вариант:

```text
MCP tool
  ↓
X5 HTTP
  ↓
return raw receipt
```

Причины отказа:

1. X5 — неофициальный API.
2. Формат может измениться.
3. Авторизация может истечь.
4. Аналитические запросы будут постоянно обращаться к X5.
5. Поиск по тысячам товаров через внешнее API будет медленным.
6. Повторные запросы создают ненужную нагрузку.
7. Исторические данные могут со временем исчезать с X5.
8. MCP-интерфейс не должен зависеть от transport/details конкретного сайта.

Поэтому X5 используется как **source of truth для синхронизации**, SQLite — как **рабочее аналитическое хранилище**.

---

# 5. Авторизация

## Решение для MVP

Не реализовывать полноценный OAuth X5 ID.

Использовать существующую пользовательскую browser session.

Конфигурация:

```env
X5_COOKIE="..."
```

HTTP client должен отправлять:

```http
Cookie: ${X5_COOKIE}
```

Не хранить cookie:

* в git;
* в исходниках;
* в тест fixtures;
* в логах;
* в SQLite.

Добавить:

```text
.env
.env.local
data/
```

в `.gitignore`.

## Почему

Цель MVP — доказать работоспособность интеграции.

Reverse engineering login flow не нужен для первой версии.

## Будущее

Позже можно реализовать:

```text
X5 ID OAuth / refresh token
```

или browser-assisted login.

Это отдельный ADR.

---

# 6. Безопасность

Cookies X5 фактически дают доступ к аккаунту.

Требования:

* никогда не логировать полный Cookie header;
* никогда не логировать JWT;
* редактировать секреты в ошибках;
* MCP по умолчанию работает через `stdio`, а не публичный HTTP;
* база хранится локально;
* сервер не должен слушать внешний интерфейс.

---

# 7. Технологии

Runtime:

```text
Node.js
TypeScript
```

Package manager:

```text
pnpm
```

Validation:

```text
zod
```

Database:

```text
SQLite
```

Рекомендуемый driver:

```text
better-sqlite3
```

Tests:

```text
vitest
```

MCP:

```text
@modelcontextprotocol/server
```

На сентябрь 2026 официальный TypeScript SDK MCP v2 является stable release line и разделён на пакеты `@modelcontextprotocol/server` и `@modelcontextprotocol/client`.

Transport для локальной версии:

```text
stdio
```

---

# 8. Структура проекта

```text
x5-mcp/
├─ src/
│  ├─ config/
│  │  └─ env.ts
│  │
│  ├─ x5/
│  │  ├─ client.ts
│  │  ├─ types.ts
│  │  ├─ decoder.ts
│  │  ├─ normalize.ts
│  │  └─ errors.ts
│  │
│  ├─ db/
│  │  ├─ database.ts
│  │  ├─ migrations.ts
│  │  ├─ receipts.repository.ts
│  │  └─ analytics.repository.ts
│  │
│  ├─ sync/
│  │  └─ sync-history.ts
│  │
│  ├─ mcp/
│  │  ├─ server.ts
│  │  └─ tools/
│  │     ├─ sync-history.ts
│  │     ├─ get-spending.ts
│  │     ├─ search-purchases.ts
│  │     ├─ get-product-history.ts
│  │     └─ get-recent-receipts.ts
│  │
│  └─ index.ts
│
├─ tests/
│  ├─ fixtures/
│  ├─ decoder.test.ts
│  ├─ normalize.test.ts
│  └─ repositories.test.ts
│
├─ data/
│  └─ x5.sqlite
│
├─ docs/
│  └─ ADR-001-x5-mcp.md
│
├─ .env.example
├─ .gitignore
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

# 9. X5 HTTP client

Интерфейс:

```ts
export interface X5HistoryRequest {
    page: number;
    type: "receipts";
    from: string;
    to: string;
    codeTc: string;
}

export interface X5Client {
    getReceiptHistory(
        request: X5HistoryRequest,
    ): Promise<X5HistoryResponse>;
}
```

HTTP request:

```ts
const body = new URLSearchParams({
    page: String(input.page),
    type: input.type,
    from: input.from,
    to: input.to,
    codeTc: input.codeTc,
});

await fetch("https://x5club.ru/lk/history.data", {
    method: "POST",

    headers: {
        accept: "*/*",
        "content-type":
            "application/x-www-form-urlencoded;charset=UTF-8",

        cookie: config.x5Cookie,

        origin: "https://x5club.ru",
        referer: "https://x5club.ru/",
    },

    body,
});
```

Не копировать все browser headers.

Не нужны:

```text
sec-ch-ua
sentry-trace
baggage
priority
accept-language
user-agent
ym cookies
matomo cookies
```

Начать с минимального набора.

Если X5 отвергает запрос — добавлять заголовки только после доказательства необходимости.

---

# 10. Decoder

Это наиболее неопределённая часть MVP.

Ответ `/lk/history.data` может использовать React Router/turbo-stream serialization.

Требование:

```ts
interface HistoryDecoder {
    decode(response: Response): Promise<DecodedHistory>;
}
```

Ожидаемый domain result:

```ts
interface DecodedHistory {
    receipts: unknown[];
    isNewData?: boolean;
}
```

Decoder обязан скрывать transport serialization от остального приложения.

То есть код выше decoder никогда не должен знать о:

```text
turbo-stream
React Router
.data
_routes
```

## Первая задача Codex

Получить реальный response body POST запроса и определить:

1. content-type;
2. является ли ответ JSON;
3. является ли ответ turbo-stream;
4. каким официальным/runtime decoder его можно разобрать.

Не писать собственный универсальный turbo-stream parser, пока не проверено существующее решение.

---

# 11. Нормализованная модель

```ts
export interface Receipt {
    id: string;

    transactionId?: string;

    createdAt: string;

    networkCode?: string;

    title?: string;

    storeId?: string;

    storeAddress?: string;

    totalRegular: number | null;

    totalPaid: number | null;

    discount: number | null;

    checkNumber?: string;

    fiscalNumber?: string;

    ofdUrl?: string;
}
```

```ts
export interface ReceiptItem {
    receiptId: string;

    pluId: string | null;

    name: string;

    quantity: number;

    unit: string | null;

    regularPrice: number | null;

    paidPrice: number | null;

    discount: number | null;

    categoryCode: string | null;

    imageUrl: string | null;
}
```

---

# 12. Денежные значения

Не использовать JS floating point в SQLite как источник истины.

Хранить деньги в копейках:

```text
109.99 ₽ → 10999
```

Поля:

```text
total_regular_minor
total_paid_minor
regular_price_minor
paid_price_minor
discount_minor
```

Helper:

```ts
toMinorUnits("109.99") === 10999
```

---

# 13. SQLite schema

## receipts

```sql
CREATE TABLE receipts (
    id TEXT PRIMARY KEY,

    transaction_id TEXT,

    created_at TEXT NOT NULL,

    network_code TEXT,

    title TEXT,

    store_id TEXT,
    store_address TEXT,

    total_regular_minor INTEGER,
    total_paid_minor INTEGER,
    discount_minor INTEGER,

    check_number TEXT,
    fiscal_number TEXT,
    ofd_url TEXT,

    synced_at TEXT NOT NULL
);
```

## receipt_items

```sql
CREATE TABLE receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    receipt_id TEXT NOT NULL,

    plu_id TEXT,
    name TEXT NOT NULL,

    quantity REAL NOT NULL,
    unit TEXT,

    regular_price_minor INTEGER,
    paid_price_minor INTEGER,
    discount_minor INTEGER,

    category_code TEXT,
    image_url TEXT,

    FOREIGN KEY (receipt_id)
        REFERENCES receipts(id)
        ON DELETE CASCADE
);
```

Indexes:

```sql
CREATE INDEX idx_receipts_created_at
ON receipts(created_at);

CREATE INDEX idx_receipt_items_plu
ON receipt_items(plu_id);

CREATE INDEX idx_receipt_items_name
ON receipt_items(name);

CREATE INDEX idx_items_receipt
ON receipt_items(receipt_id);
```

---

# 14. Receipt identity

Предпочтительный ключ:

```text
rtlTxnId
```

Если поле присутствует, использовать его как `receipt.id`.

Fallback:

```text
networkCode +
fiscalNumber +
checkNumber +
createdAt
```

Не использовать порядковый номер страницы.

---

# 15. Sync algorithm

API пагинируется.

Из frontend видно, что UI последовательно увеличивает `page`.

Алгоритм:

```ts
page = 0

while (true) {
    result = fetch(page)

    if (result.receipts.length === 0) {
        break
    }

    upsert(result.receipts)

    page++
}
```

При пустом `additionalReceiptsResponse` frontend считает данные закончившимися.

## Диапазоны

Не пытаться загружать несколько лет одним диапазоном.

Основная стратегия:

```text
месяц → страницы → следующий месяц
```

Например:

```text
2026-01-01 .. 2026-01-31
2026-02-01 .. 2026-02-28
...
```

Преимущества:

* resumable sync;
* простой retry;
* меньше объём одного запроса;
* проще диагностировать пропуски;
* проще incremental sync.

---

# 16. Idempotency

Повторный sync не должен дублировать данные.

Использовать:

```sql
INSERT ... ON CONFLICT(id) DO UPDATE
```

Для items допустимо при обновлении чека:

```text
BEGIN
UPDATE receipt
DELETE receipt_items WHERE receipt_id = ?
INSERT current items
COMMIT
```

---

# 17. Initial sync

CLI:

```bash
pnpm x5:sync --from 2025-01-01 --to 2026-09-05
```

или:

```bash
pnpm x5:sync
```

с defaults:

```text
from = начало доступной истории или заданная env
to   = сегодня
```

На MVP достаточно явных `--from` и `--to`.

---

# 18. Incremental sync

После initial import:

```text
sync from lastSync - 7 days
to today
```

Небольшое перекрытие специально допускается.

Благодаря upsert повторные чеки не создадут дублей.

---

# 19. MCP tools

MCP не должен возвращать всю базу модели.

Tools должны выполнять агрегацию локально.

## x5_sync_history

```ts
{
    from?: string;
    to?: string;
}
```

Response:

```ts
{
    monthsProcessed: number;
    receiptsInserted: number;
    receiptsUpdated: number;
    itemsProcessed: number;
}
```

---

## x5_get_recent_receipts

Input:

```ts
{
    limit?: number;
}
```

Default:

```text
10
```

---

## x5_get_spending

Input:

```ts
{
    from: string;
    to: string;
    network?: string;
    groupBy?: "day" | "week" | "month";
}
```

Response:

```ts
{
    total: number;
    receiptsCount: number;
    averageReceipt: number;
    groups?: Array<{
        period: string;
        total: number;
    }>;
}
```

---

## x5_search_purchases

Input:

```ts
{
    query: string;
    from?: string;
    to?: string;
    limit?: number;
}
```

Search over:

```text
receipt_items.name
```

Prefer SQLite search, не X5 HTTP.

---

## x5_get_product_history

Input:

```ts
{
    pluId?: string;
    query?: string;
}
```

Если известен `pluId`, он приоритетнее text matching.

Response:

```ts
{
    product: {
        pluId?: string;
        name: string;
    };

    purchases: Array<{
        date: string;
        quantity: number;
        regularPrice: number | null;
        paidPrice: number | null;
        store?: string;
    }>;
}
```

---

# 20. Почему PLU важнее названия

Название товара может меняться.

PLU является лучшим кандидатом для product identity.

Например:

```text
3019914
```

может стабильно обозначать один товар при изменении его отображаемого названия.

Поэтому:

```text
plu_id
```

— основной идентификатор товара для price history.

---

# 21. MCP transport

Для MVP:

```text
stdio
```

Причины:

* локальный персональный сервер;
* не нужен HTTP port;
* секреты остаются локально;
* проще подключить к MCP host.

Официальный MCP TypeScript SDK v2 поддерживает stdio transport.

---

# 22. Ошибки

Создать domain errors:

```ts
X5AuthenticationError
X5RequestError
X5DecodeError
X5RateLimitError
X5UnexpectedResponseError
```

Например:

```ts
if (response.status === 401 || response.status === 403) {
    throw new X5AuthenticationError(
        "X5 session expired. Refresh X5_COOKIE."
    );
}
```

Не выводить cookie.

---

# 23. Rate limiting

Это внутренний API сайта, а не официально опубликованный developer API.

Поэтому обращаться осторожно.

Initial sync:

```text
1 request at a time
```

Между страницами допустима небольшая задержка.

Не делать:

```text
Promise.all(100 months)
```

Не пытаться обойти ограничения X5.

---

# 24. Tests

HTTP слой тестировать через fixtures.

Не делать реальный X5 запрос в обычном:

```bash
pnpm test
```

Минимальный набор:

### decoder.test.ts

Проверяет:

```text
raw response
→ additionalReceiptsResponse
```

### normalize.test.ts

Проверяет:

```text
X5 receipt
→ Receipt + ReceiptItem[]
```

Обязательно:

```text
string price → integer minor units
quantity
missing promo price
multiple quantity
missing category
```

### repositories.test.ts

Проверяет:

```text
upsert
no duplicate receipts
replace items
product history
spending aggregation
```

---

# 25. Fixtures

После успешного запроса сохранить обезличенный response:

```text
tests/fixtures/history-page.txt
```

Удалить:

* имя;
* телефон;
* email;
* loyalty card;
* auth tokens;
* точный домашний/чувствительный адрес при необходимости.

Оставить структуру receipt data.

---

# 26. Логирование

Допустимо:

```text
sync month=2026-08 page=3 receipts=5
```

Недопустимо:

```text
cookie=...
authorization=...
refresh_token=...
```

---

# 27. Definition of Done MVP

MVP готов, когда выполняется всё:

1. `pnpm test` проходит.
2. X5 client получает одну страницу истории.
3. Decoder превращает production response в объекты.
4. Pagination работает до пустой страницы.
5. Можно синхронизировать выбранный месяц.
6. Повторный sync не создаёт дубли.
7. Данные сохраняются в SQLite.
8. Сохраняются товары чека.
9. MCP запускается через stdio.
10. MCP tool возвращает последние покупки.
11. MCP tool считает расходы за период.
12. MCP tool ищет товар по названию.
13. MCP tool показывает историю цены по PLU.
14. Секреты отсутствуют в git.
15. Истёкшая X5 session выдаёт понятную ошибку.

---

# Implementation Guide for Codex

## Phase 0. Bootstrap

Создай TypeScript Node repository.

Требования:

```text
pnpm
strict TypeScript
ESM
Node current LTS
Vitest
Zod
better-sqlite3
dotenv
@modelcontextprotocol/server
```

Создай:

```text
src/
tests/
data/
docs/
```

Настрой:

```text
typecheck
test
lint
build
dev
```

Не начинай MCP tools до успешного X5 client proof-of-concept.

---

## Phase 1. X5 probe

Создай временный:

```text
src/x5/probe.ts
```

Environment:

```env
X5_COOKIE=
```

Сделай запрос:

```http
POST https://x5club.ru/lk/history.data
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
```

Payload:

```text
page=0
type=receipts
from=<small range>
to=<small range>
codeTc=D,S,VK,SL,VP
```

Сначала используй небольшой период, например несколько дней.

При запуске:

```bash
pnpm x5:probe
```

вывести только:

```text
HTTP status
content-type
body length
первые безопасные ~500 символов
```

Не логировать credentials.

### Acceptance

Получен HTTP 200 и response body.

---

## Phase 2. Determine serialization

Исследуй body.

Если JSON:

```ts
await response.json()
```

Если React Router/turbo-stream:

* проверь установленный React Router/turbo-stream decoder;
* используй существующий decoder;
* не реализуй полный format parser самостоятельно без необходимости.

Получить:

```ts
{
    additionalReceiptsResponse: [...]
}
```

### Acceptance

```ts
const result = await client.getReceiptHistory(...)
expect(result.receipts).toBeInstanceOf(Array)
```

---

## Phase 3. Capture fixture

Сохрани обезличенный response.

После этого большая часть разработки должна выполняться offline.

---

## Phase 4. Domain normalization

Создай:

```text
src/x5/normalize.ts
```

Transformation:

```text
raw X5 receipt
    ↓
Receipt
ReceiptItem[]
```

Не распространяй raw X5 shape дальше `x5/`.

---

## Phase 5. SQLite

Реализуй schema и repository.

API:

```ts
saveReceipts(receipts): void

getRecentReceipts(limit): Receipt[]

getSpending(params): SpendingResult

searchPurchases(params): PurchaseSearchResult[]

getProductHistory(params): ProductHistory
```

---

## Phase 6. Monthly sync

Создай:

```ts
syncHistory({
    from,
    to
})
```

Разбей диапазон по календарным месяцам.

Для каждого месяца:

```text
page 0
page 1
page 2
...
empty
```

Сохраняй сразу после каждой страницы.

Не держать весь multi-year dataset в RAM.

---

## Phase 7. CLI verification

Реализуй команды:

```bash
pnpm x5:sync --from 2026-08-01 --to 2026-08-31

pnpm x5:recent

pnpm x5:search "Черноголовка"
```

До MCP слой должен быть полностью работоспособен через CLI.

---

## Phase 8. MCP

После работающего local domain layer создать MCP stdio server.

Tools MVP:

```text
x5_sync_history
x5_get_recent_receipts
x5_get_spending
x5_search_purchases
x5_get_product_history
```

MCP handlers должны быть тонкими:

```text
validate args
↓
repository/service call
↓
compact JSON/text response
```

В MCP handlers не размещать SQL и HTTP implementation details.

---

# Codex working rules

При реализации следуй следующим правилам.

1. Не меняй архитектуру без причины.
2. Не реализуй X5 login/OAuth в MVP.
3. Не коммить cookies или fixtures с токенами.
4. Не копируй Chrome cURL целиком в код.
5. Используй минимально необходимые HTTP headers.
6. Не выполняй параллельный массовый scraping.
7. Не делай MCP до рабочего CLI.
8. Не придумывай response schema — сначала зафиксируй реальный response.
9. Не использовать `any` на границе после normalization.
10. Raw external data валидировать.
11. Все денежные значения хранить integer minor units.
12. Все даты хранить ISO.
13. Все sync операции должны быть idempotent.
14. Любая ошибка авторизации должна явно говорить, что нужно обновить X5 session.
15. Не логировать секреты.

---

# Первый task для Codex

Выполни только Phase 0–2.

Цель первого изменения:

```text
создать проект
+
сделать X5 history client
+
получить одну страницу receipt history
+
декодировать response
+
покрыть decoder fixture-тестом
```

Не создавать пока:

```text
SQLite
MCP
analytics
OAuth
```

После завершения покажи:

1. найденный фактический формат response;
2. выбранный способ decoding;
3. normalized пример одного receipt;
4. результаты tests;
5. любые обнаруженные отличия API от ADR.

После этого переходить к Phase 3–8.
