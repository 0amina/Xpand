# Packaging module

CRUD + search for packaging items (bottles, boxes, labels…). Its two relationships —
**supplier ↔ packaging** and **product ↔ packaging** — are **read-only** here; the write side
lives on the supplier and product modules respectively. This module exposes the read views at
`GET /:id/suppliers` and `GET /:id/products`.

Base path: `/api/packaging`. All routes require the `x-telegram-id` header, and that is the only
requirement — reads and writes alike are open to any authenticated user.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header).
2. Add header `x-telegram-id: 111` to every request; `Content-Type: application/json` for bodies.

> `unitCost` is money (≤ 2 decimals), returned as a string. To create/change the actual links,
> use the supplier module (`PUT /api/suppliers/:id/packaging/:packagingId`) and product module
> (`PUT /api/products/:id/packaging/:packagingId`).

## Endpoints

| Method & path                         | Access | Description                            |
| ------------------------------------- | ------ | -------------------------------------- |
| `GET    /api/packaging`               | auth   | List. `?search=` matches name or unit. |
| `GET    /api/packaging/:id`           | auth   | One item + suppliers & products.       |
| `POST   /api/packaging`               | auth   | Create.                                |
| `PATCH  /api/packaging/:id`           | auth   | Update (≥ 1 field).                    |
| `DELETE /api/packaging/:id`           | auth   | 409 if referenced by a transaction.    |
| `GET    /api/packaging/:id/suppliers` | auth   | Suppliers that provide this packaging. |
| `GET    /api/packaging/:id/products`  | auth   | Products that use it (with quantity).  |

## Examples

### Create packaging

```bash
curl -X POST http://localhost:3000/api/packaging \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "name": "Glass Bottle 1L", "unit": "bottle", "unitCost": 0.85 }'
```

```json
{
  "data": {
    "id": 1,
    "name": "Glass Bottle 1L",
    "unit": "bottle",
    "unitCost": "0.85",
    "createdAt": "2026-08-29T10:00:00.000Z",
    "suppliers": [],
    "products": []
  }
}
```

### List / search / get one

```bash
curl 'http://localhost:3000/api/packaging?search=bottle' -H 'x-telegram-id: 111'
curl http://localhost:3000/api/packaging/1              -H 'x-telegram-id: 111'
```

### Update

```bash
curl -X PATCH http://localhost:3000/api/packaging/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "unitCost": 0.90 }'
```

### Read its relationships

```bash
curl http://localhost:3000/api/packaging/1/suppliers -H 'x-telegram-id: 111'
curl http://localhost:3000/api/packaging/1/products  -H 'x-telegram-id: 111'
```

```json
{
  "data": [
    {
      "productId": 1,
      "quantity": 1,
      "product": { "id": 1, "name": "Olive Oil 1L", "sku": "OO-1L" }
    }
  ]
}
```

To create these links, use the supplier / product modules (see their READMEs).

### Delete packaging

```bash
curl -X DELETE http://localhost:3000/api/packaging/1 -H 'x-telegram-id: 111'
```

204 when unused; **409** if a transaction references it. Supplier/product links cascade.

## Error responses you can trigger

| Status | How                                                                            |
| ------ | ------------------------------------------------------------------------------ |
| 401    | Omit the `x-telegram-id` header.                                               |
| 400    | Missing `name`; `unitCost` with > 2 decimals; empty PATCH; `:id` not a number. |
| 404    | Unknown packaging id.                                                          |
| 409    | Deleting packaging referenced by a transaction.                                |
