# OAuth return-origin hardening

Wildcard CORS (`corsOrigins: "*"`) does not authorize wildcard OAuth redirects.

OAuth return URLs are restricted to:

- the API `baseUrl` origin;
- explicitly listed CORS origins when `corsOrigins` is an array; and
- `allowedReturnOrigins`.

This prevents an embeddable public widget configuration from becoming an open redirect after OAuth authentication.
