# Categories module

CRUD for 11 fixed transaction categories (Sales, Salary, Refund, etc.). Each category has a `type` (INCOME, EXPENSE, or BOTH). Transactions must match category type (e.g., a SALARY income category cannot be used for an EXPENSE transaction).

Base path: `/api/categories`. All routes require the `x-telegram-id` header, and that is the only requirement — reads and writes alike are open to any authenticated user.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header).
2. Add header `x-telegram-id: 111` to every request; `Content-Type: application/json` for bodies.

> The 11 built-in categories are pre-seeded. You can't delete them if transactions reference them (409).

## Endpoints

| Method & path                | Access | Description                                 |
| ---------------------------- | ------ | ------------------------------------------- |
| `GET    /api/categories`     | auth   | List all. `?type=INCOME` to filter by type. |
| `GET    /api/categories/:id` | auth   | One category.                               |
| `POST   /api/categories`     | auth   | Create. 409 on duplicate name.              |
| `PATCH  /api/categories/:id` | auth   | Update (≥ 1 field).                         |
| `DELETE /api/categories/:id` | auth   | 409 if a transaction references it.         |

## Examples

### List categories

```bash
curl http://localhost:3000/api/categories \
  -H 'x-telegram-id: 111'
```

Response:

```json
{
  "data": [
    { "id": 1, "name": "Sales", "type": "INCOME", "icon": "💰", "color": "#2ECC71" },
    { "id": 2, "name": "Salary", "type": "INCOME", "icon": "💼", "color": "#3498DB" },
    { "id": 3, "name": "Rent", "type": "EXPENSE", "icon": "🏠", "color": "#E74C3C" },
    ...
  ]
}
```

### Filter by type

```bash
curl 'http://localhost:3000/api/categories?type=INCOME' \
  -H 'x-telegram-id: 111'
```

### Get one category

```bash
curl http://localhost:3000/api/categories/1 \
  -H 'x-telegram-id: 111'
```

### Create a category

```bash
curl -X POST http://localhost:3000/api/categories \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "name": "Other", "type": "BOTH", "icon": "❓", "color": "#95A5A6" }'
```

### Update

```bash
curl -X PATCH http://localhost:3000/api/categories/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "color": "#FFFFFF" }'
```

### Delete (409 if transactions reference it)

```bash
curl -X DELETE http://localhost:3000/api/categories/99 \
  -H 'x-telegram-id: 111'
```

## Error responses you can trigger

| Status | How                                                                      |
| ------ | ------------------------------------------------------------------------ |
| 401    | Omit the `x-telegram-id` header.                                         |
| 400    | Missing `name`; invalid `type`; empty PATCH; `:id` not a number.         |
| 404    | Unknown category id.                                                     |
| 409    | Duplicate category name; deleting a category referenced by transactions. |
