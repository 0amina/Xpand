# Suppliers module

CRUD + search for suppliers, plus the write side of two relationships:
**supplier ↔ product** and **supplier ↔ packaging** (each carries a negotiated `unitPrice`).

Base path: `/api/suppliers`. All routes require the `x-telegram-id` header, and that is the only
requirement — reads, writes and link/unlink alike are open to any authenticated user.

## Postman setup

1. `POST /api/users/login` with `{ "id": 111, "firstName": "Boss" }` (no auth header) to create
   your user.
2. In Postman, add a header to every request below: **Key** `x-telegram-id` **Value** `111`.
   For JSON bodies also set `Content-Type: application/json`.

> Replace `:id`, `:productId`, `:packagingId` with real ids. `unitPrice` is optional (money,
> ≤ 2 decimals). Responses are wrapped in `{ "data": ... }`; errors in `{ "error": ... }`.

## Endpoints

| Method & path                                      | Access | Description                                        |
| -------------------------------------------------- | ------ | -------------------------------------------------- |
| `GET    /api/suppliers`                            | auth   | List. `?search=` matches name/contact/email/phone. |
| `GET    /api/suppliers/:id`                        | auth   | One supplier + linked products & packaging.        |
| `POST   /api/suppliers`                            | auth   | Create.                                            |
| `PATCH  /api/suppliers/:id`                        | auth   | Update (≥ 1 field).                                |
| `DELETE /api/suppliers/:id`                        | auth   | 409 if referenced by a transaction.                |
| `GET    /api/suppliers/:id/products`               | auth   | Products this supplier carries.                    |
| `PUT    /api/suppliers/:id/products/:productId`    | auth   | Link / re-price a product (upsert).                |
| `DELETE /api/suppliers/:id/products/:productId`    | auth   | Unlink a product.                                  |
| `GET    /api/suppliers/:id/packaging`              | auth   | Packaging this supplier provides.                  |
| `PUT    /api/suppliers/:id/packaging/:packagingId` | auth   | Link / re-price packaging (upsert).                |
| `DELETE /api/suppliers/:id/packaging/:packagingId` | auth   | Unlink packaging.                                  |

## Examples

### Create a supplier

```bash
curl -X POST http://localhost:3000/api/suppliers \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{
        "name": "Acme Foods",
        "contactPerson": "Ali Ben Salah",
        "phone": "+216 20 000 000",
        "email": "ali@acme.tn",
        "address": "Zone Industrielle, Sfax",
        "notes": "Preferred vendor"
      }'
```

```json
{
  "data": {
    "id": 1,
    "name": "Acme Foods",
    "contactPerson": "Ali Ben Salah",
    "phone": "+216 20 000 000",
    "email": "ali@acme.tn",
    "address": "Zone Industrielle, Sfax",
    "notes": "Preferred vendor",
    "createdAt": "2026-08-29T10:00:00.000Z",
    "products": [],
    "packaging": []
  }
}
```

### List / search

```bash
curl http://localhost:3000/api/suppliers               -H 'x-telegram-id: 111'
curl 'http://localhost:3000/api/suppliers?search=acme' -H 'x-telegram-id: 111'
```

### Get one (with relationships embedded)

```bash
curl http://localhost:3000/api/suppliers/1 -H 'x-telegram-id: 111'
```

### Update

```bash
curl -X PATCH http://localhost:3000/api/suppliers/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "phone": "+216 21 111 111", "notes": "Net-30 terms" }'
```

### Link a product to this supplier (with a negotiated price)

```bash
curl -X PUT http://localhost:3000/api/suppliers/1/products/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' \
  -d '{ "unitPrice": 10.50 }'
```

```json
{
  "data": {
    "productId": 1,
    "unitPrice": "10.50",
    "product": { "id": 1, "name": "Olive Oil 1L", "sku": "OO-1L" }
  }
}
```

Calling `PUT` again with a different `unitPrice` re-prices the same link (idempotent upsert).

### Link packaging, list, unlink

```bash
curl -X PUT http://localhost:3000/api/suppliers/1/packaging/1 \
  -H 'x-telegram-id: 111' -H 'Content-Type: application/json' -d '{ "unitPrice": 0.80 }'

curl http://localhost:3000/api/suppliers/1/products  -H 'x-telegram-id: 111'
curl http://localhost:3000/api/suppliers/1/packaging -H 'x-telegram-id: 111'

curl -X DELETE http://localhost:3000/api/suppliers/1/products/1 -H 'x-telegram-id: 111'
```

### Delete a supplier

```bash
curl -X DELETE http://localhost:3000/api/suppliers/1 -H 'x-telegram-id: 111'
```

Returns **204** when unused. If any transaction references the supplier you get **409**
(`"Cannot delete supplier 1: it is referenced by N transaction(s)"`). Product/packaging links
are removed automatically (junction rows cascade).

## Error responses you can trigger

| Status | How                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------- |
| 401    | Omit the `x-telegram-id` header.                                                                  |
| 400    | Missing `name`; invalid `email`; empty PATCH body; `:id` not a number.                            |
| 404    | Unknown supplier id; linking a non-existent product/packaging; unlinking a link that isn't there. |
| 409    | Deleting a supplier still referenced by a transaction.                                            |
