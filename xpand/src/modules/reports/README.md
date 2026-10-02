# Reports module

Financial summaries: **cash position** (current balance) and **income/expenses by category** (breakdown). Both cover every user by default — the company-wide position is the point — and `?userId=` narrows either one to a single person.

Base path: `/api/reports`. All routes require the `x-telegram-id` header and auth.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header).
2. Create some transactions first (see transactions README).
3. Add header `x-telegram-id: 111` to every request.

## Endpoints

| Method & path                     | Access | Description                            |
| --------------------------------- | ------ | -------------------------------------- |
| `GET    /api/reports/summary`     | auth   | Cash position (opening balance + net). |
| `GET    /api/reports/by-category` | auth   | Grouped by category (income/expense).  |

## Examples

### Cash position (summary)

```bash
curl 'http://localhost:3000/api/reports/summary' \
  -H 'x-telegram-id: 111'
```

Response:

```json
{
  "data": {
    "asOf": "2026-08-30",
    "openingBalance": "0.00",
    "totalIncome": "250.50",
    "totalExpense": "50.00",
    "netMovement": "200.50",
    "closingBalance": "200.50",
    "today": {
      "income": "250.50",
      "expense": "50.00",
      "net": "200.50"
    },
    "thisMonth": {
      "income": "250.50",
      "expense": "50.00",
      "net": "200.50"
    }
  }
}
```

### Summary as of a specific date

```bash
curl 'http://localhost:3000/api/reports/summary?on=2026-08-15' \
  -H 'x-telegram-id: 111'
```

### Summary with custom opening balance

```bash
curl 'http://localhost:3000/api/reports/summary?openingBalance=1000.00' \
  -H 'x-telegram-id: 111'
```

### View one user's summary

```bash
curl 'http://localhost:3000/api/reports/summary?userId=222' \
  -H 'x-telegram-id: 111'
```

### Income & expense by category

```bash
curl 'http://localhost:3000/api/reports/by-category' \
  -H 'x-telegram-id: 111'
```

Response:

```json
{
  "data": [
    {
      "categoryId": 1,
      "categoryName": "Sales",
      "type": "INCOME",
      "total": "250.50"
    },
    {
      "categoryId": 3,
      "categoryName": "Rent",
      "type": "EXPENSE",
      "total": "50.00"
    }
  ]
}
```

### Filter by category type (INCOME or EXPENSE)

```bash
curl 'http://localhost:3000/api/reports/by-category?type=INCOME' \
  -H 'x-telegram-id: 111'
```

### Filter by date range

```bash
curl 'http://localhost:3000/api/reports/by-category?from=2026-08-01&to=2026-08-31' \
  -H 'x-telegram-id: 111'
```

## Error responses you can trigger

| Status | How                                                                 |
| ------ | ------------------------------------------------------------------- |
| 401    | Omit the `x-telegram-id` header.                                    |
| 400    | Invalid date format (use YYYY-MM-DD); non-numeric `openingBalance`. |
