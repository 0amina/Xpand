# Transactions module

Income and expense logging. Each transaction is linked to a category, has an amount (TND currency), and optionally a supplier, product, or packaging. Every authenticated user sees every transaction; `?userId=` narrows the list to one person.

Base path: `/api/transactions`. All routes require the `x-telegram-id` header. **Reads and writes** are available to any authenticated user, on any row — the books are the company's. `user_id` records who logged the entry, and grants nothing.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header).
2. Add header `x-telegram-id: 111` to every request; `Content-Type: application/json` for bodies.

> `amount` is in **TND** currency, must be > 0, max 2 decimals (e.g., 12.50). Amounts come back as strings (e.g., `"12.50"`) to preserve precision.

## Endpoints

| Method & path                  | Access | Description                                 |
| ------------------------------ | ------ | ------------------------------------------- |
| `GET    /api/transactions`     | auth   | List all. `?userId=` narrows to one person. |
| `GET    /api/transactions/:id` | auth   | One transaction.                            |
| `POST   /api/transactions`     | auth   | Create. Amount > 0, ≤ 2 decimals.           |
| `PATCH  /api/transactions/:id` | auth   | Update.                                     |
| `DELETE /api/transactions/:id` | auth   | Delete.                                     |

## Examples

### Create a transaction (income)

```bash
curl -X POST http://localhost:3000/api/transactions \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{
    "type": "INCOME",
    "categoryId": 1,
    "amount": 250.50,
    "description": "Daily sales",
    "transactionDate": "2026-08-30"
  }'
```

Response:

```json
{
  "data": {
    "id": 1,
    "userId": "111",
    "type": "INCOME",
    "amount": "250.50",
    "currency": "TND",
    "categoryId": 1,
    "description": "Daily sales",
    "transactionDate": "2026-08-30",
    "paymentMethod": null,
    "supplierId": null,
    "productId": null,
    "packagingId": null,
    "createdAt": "2026-08-30T10:00:00.000Z"
  }
}
```

### Create an expense

```bash
curl -X POST http://localhost:3000/api/transactions \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{
    "type": "EXPENSE",
    "categoryId": 3,
    "amount": 50.00,
    "description": "Office supplies",
    "paymentMethod": "BANK_TRANSFER"
  }'
```

Date defaults to today if omitted.

### List your transactions

```bash
curl http://localhost:3000/api/transactions \
  -H 'x-telegram-id: 111'
```

### Filter by category & date range (yours only)

```bash
curl 'http://localhost:3000/api/transactions?categoryId=1&from=2026-08-01&to=2026-08-31' \
  -H 'x-telegram-id: 111'
```

### Filter by type (INCOME or EXPENSE)

```bash
curl 'http://localhost:3000/api/transactions?type=INCOME' \
  -H 'x-telegram-id: 111'
```

### List every user's transactions

```bash
curl http://localhost:3000/api/transactions \
  -H 'x-telegram-id: 111'
```

Returns every user's transactions.

### See one user's transactions

```bash
curl 'http://localhost:3000/api/transactions?userId=222' \
  -H 'x-telegram-id: 111'
```

### Get one transaction

```bash
curl http://localhost:3000/api/transactions/1 \
  -H 'x-telegram-id: 111'
```

Returns 404 only if no transaction has that id.

### Update a transaction

```bash
curl -X PATCH http://localhost:3000/api/transactions/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "amount": 260.50, "description": "Corrected sales" }'
```

### Delete

```bash
curl -X DELETE http://localhost:3000/api/transactions/1 \
  -H 'x-telegram-id: 111'
```

Returns 204 (no content).

## Error responses you can trigger

| Status | How                                                                                      |
| ------ | ---------------------------------------------------------------------------------------- |
| 401    | Omit the `x-telegram-id` header.                                                         |
| 400    | Missing `type` or `categoryId`; `amount` ≤ 0 or > 2 decimals; invalid `transactionDate`. |
| 404    | Unknown transaction id or category id.                                                   |
