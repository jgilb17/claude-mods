"""Read-only MCP server for ServiceTrade (rebuilt 8 Oct 2026).

WHY READ-ONLY. The first version exposed raw get, post, put and delete on any path. Claude Code
sessions run in auto mode and claude-guard inspects Bash and SQL, not MCP calls, so nothing stood
between a misread request and a DELETE on a live job, location or customer. This version has one
tool, and it can only issue GET requests. Writes, if they are ever wanted, get their own narrow
tools with a confirmation step, never a generic verb.

WHY USERNAME AND PASSWORD. The OAuth API client the first version used was rejected by
ServiceTrade (401 at /api/oauth2/token, 8 Oct 2026). The Desert Fire sync jobs log in with
ST_USERNAME and ST_PASSWORD at POST /api/auth and get a session token used as the PHPSESSID
cookie; that path is in daily use, so this server uses it too. A 401 mid-session (the session
expired) triggers one fresh login and one retry; a second 401 is a real auth failure.

Environment: ST_USERNAME, ST_PASSWORD. Optional: ST_BASE (default https://api.servicetrade.com/api).
"""
import json
import os
import re

import requests
from fastmcp import FastMCP

BASE = os.environ.get("ST_BASE", "https://api.servicetrade.com/api").rstrip("/")
TIMEOUT_S = 60
MAX_CHARS = 200_000  # a response bigger than this is cut, and says so, to protect the session

# A relative API path: /job, /job/123, /location/45/contact. No scheme, host, query string,
# fragment, backslash or parent-directory step, so the path can only ever name a ServiceTrade
# resource under BASE.
PATH_OK = re.compile(r"^/[A-Za-z0-9_\-./]*$")

mcp = FastMCP("servicetrade")
_session = requests.Session()
_token: str | None = None


class STError(Exception):
    pass


def _login() -> None:
    global _token
    user, pw = os.environ.get("ST_USERNAME"), os.environ.get("ST_PASSWORD")
    if not user or not pw:
        raise STError("ST_USERNAME and ST_PASSWORD are not set in this server's environment.")
    r = _session.post(f"{BASE}/auth", json={"username": user, "password": pw}, timeout=TIMEOUT_S)
    try:
        body = r.json()
    except ValueError:
        body = {}
    token = (body.get("data") or body).get("authToken") if isinstance(body, dict) else None
    if r.status_code != 200 or not token:
        _token = None
        raise STError(f"ServiceTrade login failed (HTTP {r.status_code}). Check ST_USERNAME and ST_PASSWORD.")
    _token = token


def check_path(path: str) -> str:
    if not isinstance(path, str) or not PATH_OK.match(path) or ".." in path or "//" in path:
        raise STError(
            "path must be a relative ServiceTrade API path such as /job or /job/123, "
            "with query parameters passed in params, not in the path."
        )
    return path


def get(path: str, params: dict | None = None) -> dict:
    """GET only. The one place this server talks to ServiceTrade after logging in."""
    path = check_path(path)
    if _token is None:
        _login()
    for attempt in (1, 2):
        r = _session.request(
            "GET", f"{BASE}{path}", params=params or {}, cookies={"PHPSESSID": _token or ""}, timeout=TIMEOUT_S
        )
        if r.status_code == 401 and attempt == 1:
            _login()
            continue
        if r.status_code >= 400:
            raise STError(f"GET {path} returned HTTP {r.status_code}: {r.text[:300]}")
        try:
            return r.json()
        except ValueError:
            return {"raw": r.text}
    raise STError(f"GET {path} still unauthorised after a fresh login.")


@mcp.tool()
def st_get(path: str, params: dict | None = None) -> str:
    """Read from the ServiceTrade API. GET only; this server cannot create, change or delete anything.

    path: a relative API path such as /job, /job/123, /location/45 or /contact.
    params: optional query parameters, e.g. {"limit": 5, "status": "scheduled", "locationId": 45}.
    """
    try:
        text = json.dumps(get(path, params), default=str)
    except STError as e:
        return json.dumps({"error": str(e)})
    except requests.RequestException as e:
        return json.dumps({"error": f"network error talking to ServiceTrade: {type(e).__name__}"})
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS] + f'... [cut at {MAX_CHARS} of {len(text)} characters; narrow the query with params]'
    return text


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
