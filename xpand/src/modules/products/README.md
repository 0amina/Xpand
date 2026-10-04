# Products module

CRUD + search for products, plus the write side of **product ↔ packaging** (a `quantity`: how
many packaging units the product consumes). The **supplier ↔ product** link is read-only here
(managed from the supplier side); this module exposes it at `GET /:id/suppliers`.

Base path: `/api/products`. All routes require the `x-telegram-id` header, and that is the only
requirement — reads and writes alike are open to any authenticated user.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header).
2. Add header `x-telegram-id: 111` to every request; `Content-Type: application/json` for bodies.

> `sku` is unique when provided. `unitPrice` is money (≤ 2 decimals). Amounts come back as
> strings (e.g. `"12.50"`) to preserve precision.

## Endpoints

| Method & path                                     | Access | Description                                    |
| ------------------------------------------------- | ------ | ---------------------------------------------- |
| `GET    /api/products`                            | auth   | List. `?search=` matches name or SKU.          |
| `GET    /api/products/:id`                        | auth   | One product + suppliers & packaging.           |
| `POST   /api/products`                            | auth   | Create. 409 on duplicate SKU.                  |
| `PATCH  /api/products/:id`                        | auth   | Update (≥ 1 field). 409 on SKU clash.          |
| `DELETE /api/products/:id`                        | auth   | 409 if referenced by a transaction.            |
| `GET    /api/products/:id/packaging`              | auth   | Packaging this product uses (with quantity).   |
| `PUT    /api/products/:id/packaging/:packagingId` | auth   | Link / set quantity (upsert).                  |
| `DELETE /api/products/:id/packaging/:packagingId` | auth   | Unlink packaging.                              |
| `GET    /api/products/:id/suppliers`              | auth   | Suppliers that carry this product (read-only). |

## Examples

### Create a product

```bash
curl -X POST http://localhost:3000/api/products \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "name": "Olive Oil 1L", "sku": "OO-1L", "description": "Extra virgin", "unitPrice": 12.50 }'
```

```json
{
  "data": {
    "id": 1,
    "name": "Olive Oil 1L",
    "sku": "OO-1L",
    "description": "Extra virgin",
    "unitPrice": "12.50",
    "createdAt": "2026-08-29T10:00:00.000Z",
    "suppliers": [],
    "packaging": []
  }
}
```

### List / search / get one

```bash
curl 'http://localhost:3000/api/products?search=olive' -H 'x-telegram-id: 111'
curl http://localhost:3000/api/products/1              -H 'x-telegram-id: 111'
```

### Update

```bash
curl -X PATCH http://localhost:3000/api/products/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "unitPrice": 13.00 }'
```

`sku`, `description` and `unitPrice` accept an explicit `null`, which **clears** the column. An
omitted field is left alone, so null is the only way to remove a value that is already set.

```bash
curl -X PATCH http://localhost:3000/api/products/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "sku": null, "unitPrice": null }'
```

### Link packaging with a quantity (bill of materials)

```bash
# This product uses 1 glass bottle and 6-per-box cardboard
curl -X PUT http://localhost:3000/api/products/1/packaging/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' -d '{ "quantity": 1 }'
curl -X PUT http://localhost:3000/api/products/1/packaging/2 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' -d '{ "quantity": 6 }'
```

```json
{
  "data": {
    "packagingId": 1,
    "quantity": 1,
    "packaging": { "id": 1, "name": "Glass Bottle 1L", "unit": "bottle" }
  }
}
```

`quantity` defaults to `1` if omitted, and must be a positive integer (DB `CHECK (quantity > 0)`).

### Read the other side (which suppliers sell this), then unlink

```bash
curl http://localhost:3000/api/products/1/packaging -H 'x-telegram-id: 111'
curl http://localhost:3000/api/products/1/suppliers -H 'x-telegram-id: 111'

curl -X DELETE http://localhost:3000/api/products/1/packaging/2 -H 'x-telegram-id: 111'
```

### Delete a product

```bash
curl -X DELETE http://localhost:3000/api/products/1 -H 'x-telegram-id: 111'
```

204 when unused; **409** if a transaction references it. Supplier/packaging links cascade.

## Error responses you can trigger

| Status | How                                                                                        |
| ------ | ------------------------------------------------------------------------------------------ |
| 401    | Omit the `x-telegram-id` header.                                                           |
| 400    | Missing `name`; `unitPrice` with > 2 decimals; empty PATCH; `quantity` ≤ 0 or non-integer. |
| 404    | Unknown product id; linking non-existent packaging; unlinking a missing link.              |
| 409    | Duplicate `sku`; deleting a product referenced by a transaction.                           |
