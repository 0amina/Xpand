# Users module

Authentication and user management. Every user must first call `POST /login` to create an account (upsert via Telegram ID). There are no roles — every authenticated user can list and read every other user.

Base path: `/api/users`. **Login is public (no auth)**; other routes require the `x-telegram-id` header.

## Postman setup

1. **First request: login** (no auth header needed)

   ```
   POST /api/users/login
   x-telegram-id: (omit this header for login only)
   Content-Type: application/json

   { "id": 111, "firstName": "Your Name", "lastName": "Optional" }
   ```

2. **All other requests: add header**
   ```
   x-telegram-id: 111
   Content-Type: application/json
   ```

## Endpoints

| Method & path             | Access | Description                              |
| ------------------------- | ------ | ---------------------------------------- |
| `POST   /api/users/login` | public | Create or return user (upsert).          |
| `GET    /api/users/me`    | auth   | Logged-in user (their own profile).      |
| `GET    /api/users`       | auth   | List all users.                          |
| `GET    /api/users/:id`   | auth   | One user by id.                          |

## Examples

### 1. Login (first call, no auth header)

```bash
curl -X POST http://localhost:3000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{ "id": 111, "firstName": "Ali", "lastName": "Ben Salah" }'
```

Response:

```json
{
  "data": {
    "id": 111,
    "firstName": "Ali",
    "lastName": "Ben Salah",
    "username": null,
    "createdAt": "2026-08-30T10:00:00.000Z"
  }
}
```

**Now you can use header `x-telegram-id: 111` on all other requests.**

### 2. Get yourself (after login)

```bash
curl http://localhost:3000/api/users/me \
  -H 'x-telegram-id: 111'
```

Response: same as above (your own profile).

### 3. List all users

```bash
curl http://localhost:3000/api/users \
  -H 'x-telegram-id: 111'
```

Response:

```json
{
  "data": [
    { "id": 111, "firstName": "Ali", ... },
    { "id": 222, "firstName": "Fatima", ... }
  ]
}
```

### 4. Get one user

```bash
curl http://localhost:3000/api/users/222 \
  -H 'x-telegram-id: 111'
```

## Error responses you can trigger

| Status | How                                                                      |
| ------ | ------------------------------------------------------------------------ |
| 400    | `POST /login`: Missing `id` or `firstName`; `id` not a positive integer. |
| 401    | Omit the `x-telegram-id` header on any route except `/login`.            |
| 404    | `GET /:id` with unknown user id.                                         |

## What happens on login

- **First login**: the user row is created. Nothing else has to be granted — full access comes with being known to the app.
- **Later logins**: only the profile fields are refreshed (firstName, lastName, username).
- **ID**: Must be a positive integer (Telegram IDs can exceed JavaScript's safe integer limit, so they're stored as `BIGINT`).
