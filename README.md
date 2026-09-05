# x5-mcp

MCP-сервер для Codex, который загружает историю покупок из личного кабинета X5 Club в локальную SQLite-базу, а потом позволяет спрашивать у агента про траты, чеки, товары, категории и изменение цен.

Работает локально на компьютере пользователя. Публичный сервер не нужен, ваши чеки не хранятся у автора пакета.

## Требования

- Node.js 24.x
- Codex или другой MCP-клиент со stdio transport
- Аккаунт X5 Club и cookie из браузерной сессии

## Быстрая настройка в Codex

Добавьте MCP-сервер в конфиг Codex:

```toml
[mcp_servers.x5]
command = "npx"
args = ["-y", "x5-mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 300

[mcp_servers.x5.env]
X5_COOKIE = "name=value; other=value"
```

Перезапустите Codex или обновите MCP-подключения. После этого можно писать обычные запросы:

```text
Синхронизируй мои покупки с 2026-08-01 по 2026-08-31
```

```text
Покажи расходы по неделям за август 2026
```

```text
Найди мои покупки кофе и покажи, как менялась цена
```

```text
Какие товары я чаще всего покупал за последние 3 месяца?
```

## Как получить X5_COOKIE

1. Войдите в свой аккаунт на `https://x5club.ru`.
2. Откройте историю покупок.
3. Откройте DevTools -> Network.
4. Обновите историю или загрузите следующую страницу.
5. Найдите запрос `POST /lk/history.data`.
6. В Request Headers скопируйте значение заголовка `Cookie`.
7. Вставьте только значение, без префикса `Cookie:`.

Не отправляйте cookie в чат, issue, pull request или сторонним людям. Cookie дает доступ к вашему аккаунту.

## Где хранится база

По умолчанию SQLite создается локально:

- Windows: `%LOCALAPPDATA%/x5-purchases-mcp/x5.sqlite`
- macOS/Linux: `$XDG_DATA_HOME/x5-purchases-mcp/x5.sqlite` или `~/.local/share/x5-purchases-mcp/x5.sqlite`

Можно задать свой путь:

```toml
[mcp_servers.x5.env]
X5_COOKIE = "name=value; other=value"
X5_DB_PATH = "C:/Users/me/x5-purchases.sqlite"
```

## Доступные настройки

```toml
[mcp_servers.x5.env]
X5_COOKIE = "name=value; other=value"
X5_DB_PATH = "C:/Users/me/x5-purchases.sqlite"
X5_NETWORK_CODES = "D,S,VK,SL,VP"
X5_REQUEST_TIMEOUT_MS = "30000"
X5_PAGE_DELAY_MS = "500"
X5_MAX_PAGES_PER_MONTH = "1000"
X5_SYNC_FROM = "2026-01-01"
X5_ENABLE_SYNC_TOOL = "1"
```

Если поставить `X5_ENABLE_SYNC_TOOL = "0"`, агент сможет анализировать уже загруженную базу, но не будет сам ходить в X5 за новыми данными.

## Инструменты MCP

- `x5_sync_history`: загрузить или обновить чеки за период
- `x5_get_sync_status`: проверить покрытие и свежесть данных
- `x5_get_recent_receipts`: последние чеки
- `x5_get_receipt`: один чек с позициями
- `x5_get_spending`: траты по дням, неделям или месяцам
- `x5_search_purchases`: поиск покупок по названию
- `x5_get_product_history`: история покупок и цен конкретного товара
- `x5_get_top_products`: частые товары
- `x5_get_categories`: исходные коды категорий
- `x5_get_category_spending`: предварительная оценка трат по категориям
- `x5_get_price_changes`: сравнение первой и последней известной цены

## Важные ограничения

- Первый импорт лучше делать за явный период: например, с `2026-08-01` по `2026-08-31`.
- Отсутствие чеков в базе не значит нулевые траты, пока период не был успешно синхронизирован.
- Денежные поля `*_minor` возвращаются в копейках RUB.
- Категорийные суммы являются оценкой, потому что считаются по позициям чека.
- X5 может менять формат личного кабинета без предупреждения; если синхронизация сломалась, обновите пакет и cookie.

## Для разработки

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Локальный запуск stdio-сервера:

```sh
pnpm start
```

Публикация новой версии:

```sh
pnpm build
npm publish --access public
```
