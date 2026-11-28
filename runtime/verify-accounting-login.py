"""Health, authentication and session checks. Never write credentials or source data to output."""
import json
import sys
import urllib.error
import urllib.request

origin, bootstrap, release = sys.argv[1:]
assert origin in ("http://127.0.0.1:18089", "https://hesab.vesta-cosmetics.ir")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


client = urllib.request.build_opener(NoRedirects)


def request(path, body=None, headers=None, status=200):
    args = {"headers": {"Accept": "application/json", **(headers or {})}}
    if body is not None:
        args["data"] = json.dumps(body).encode()
        args["headers"]["Content-Type"] = "application/json"
    try:
        with client.open(urllib.request.Request(origin + path, **args), timeout=18) as result:
            assert result.status == status
            return result.headers, json.load(result)
    except urllib.error.HTTPError as err:
        if err.code != status:
            raise RuntimeError(f"unexpected accounting HTTP status {err.code}") from None
        return err.headers, {}


with open(bootstrap, encoding="utf8") as f:
    credentials = json.load(f)
headers, health = request("/health")
assert health["mode"] == "source" and health["database"] == "postgresql"
assert health["status"] == "ok" and health["version"] == release
assert isinstance(health["posting_authorized"], bool) and health["store_writes"] is False
assert headers.get("Cache-Control") == "no-store"
if origin.startswith("https:"):
    assert headers.get("Strict-Transport-Security")
request("/api/me", status=401)
headers, user = request("/api/login", {"username": credentials["ADMIN"], "password": credentials["PASS"]})
cookie = headers.get("Set-Cookie", "")
assert cookie.startswith("__Host-vesta=") and all(x in cookie for x in ("HttpOnly", "Secure", "SameSite=Strict"))
assert user["role"] == "owner" and user["mode"] == "source" and user["username"] == credentials["ADMIN"]
authenticated = {"Cookie": cookie.split(";")[0]}
request("/api/me", headers=authenticated)
request("/api/logout", {}, authenticated, status=403)
request("/api/logout", {}, {**authenticated, "X-CSRF-Token": user["csrf"]})
request("/api/me", headers=authenticated, status=401)
print("password_login_session_csrf_and_postgresql_verified=true")
