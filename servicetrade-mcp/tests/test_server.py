"""Run: python3 tests/test_server.py   (no network: requests is stubbed)"""
import asyncio, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["ST_USERNAME"] = "user@x"; os.environ["ST_PASSWORD"] = "pw"
import servicetrade_mcp.server as srv

passed = failed = 0
def ok(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print("FAIL:", name, detail)

class Resp:
    def __init__(self, status, body): self.status_code, self._b = status, body; self.text = json.dumps(body)
    def json(self): return self._b

class FakeSession:
    def __init__(self, plan): self.plan, self.calls = plan, []
    def post(self, url, json=None, timeout=None):
        self.calls.append(("POST", url, json)); return self.plan.pop(0)
    def request(self, method, url, params=None, cookies=None, timeout=None):
        self.calls.append((method, url, params, cookies)); return self.plan.pop(0)

def run(plan, path="/job", params=None):
    srv._token = None; srv._session = FakeSession(plan)
    return json.loads(srv.st_get(path, params)), srv._session.calls

# 1. Only one tool, and it is the GET tool.
tools = asyncio.run(srv.mcp.list_tools())
names = sorted(t.name for t in tools)
ok("exactly one tool, st_get", names == ["st_get"], str(names))

# 2. Logs in with username and password, then GETs with the session cookie.
out, calls = run([Resp(200, {"data": {"authToken": "TOK1"}}), Resp(200, {"data": {"jobs": [{"id": 9}]}})], "/job", {"limit": 1})
ok("login is POST /auth with the username and password", calls[0][0] == "POST" and calls[0][1].endswith("/api/auth") and calls[0][2] == {"username": "user@x", "password": "pw"}, str(calls[0]))
ok("the read is a GET with the token as PHPSESSID", calls[1][0] == "GET" and calls[1][3] == {"PHPSESSID": "TOK1"} and calls[1][2] == {"limit": 1}, str(calls[1]))
ok("the job comes back", out == {"data": {"jobs": [{"id": 9}]}}, str(out))
ok("every call after login is a GET", all(c[0] == "GET" for c in calls[1:]))

# 3. An expired session gets one fresh login and one retry.
out, calls = run([Resp(200, {"data": {"authToken": "A"}}), Resp(401, {}), Resp(200, {"data": {"authToken": "B"}}), Resp(200, {"data": {"ok": 1}})])
ok("401 then re-login then success", out == {"data": {"ok": 1}} and [c[0] for c in calls] == ["POST", "GET", "POST", "GET"], str(calls))
ok("the retry uses the new token", calls[3][3] == {"PHPSESSID": "B"})

# 4. Two 401s in a row is a real failure, reported, not looped.
out, calls = run([Resp(200, {"data": {"authToken": "A"}}), Resp(401, {}), Resp(200, {"data": {"authToken": "B"}}), Resp(401, {})])
ok("second 401 is an error", "error" in out and len(calls) == 4, str(out))

# 5. Bad login is a clear error, and no data call is made.
out, calls = run([Resp(401, {"messages": {"error": ["bad"]}})])
ok("failed login reported", "login failed" in out.get("error", "") and len(calls) == 1, str(out))

# 6. Paths that could escape the API are refused before any network call.
for bad in ["https://evil.example/job", "//evil.example/job", "/job/../../auth", "/job?x=1", "job", "/job#x", "\\job"]:
    out, calls = run([], bad)
    ok(f"refused path {bad!r}", "error" in out and calls == [], str(out))

# 7. Huge responses are cut and say so.
big = {"data": "x" * (srv.MAX_CHARS + 50)}
srv._token = None; srv._session = FakeSession([Resp(200, {"data": {"authToken": "T"}}), Resp(200, big)])
txt = srv.st_get("/job")
ok("oversize response is cut with a note", len(txt) < srv.MAX_CHARS + 200 and "cut at" in txt)

# 8. Missing credentials are a message, not a crash at startup.
os.environ.pop("ST_PASSWORD")
out, calls = run([])
ok("missing env is a readable error", "ST_USERNAME and ST_PASSWORD" in out.get("error", ""), str(out))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
