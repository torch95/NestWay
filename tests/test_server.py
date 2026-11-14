"""Unit tests for server.py (Stateless Read-Only ETF DB & Static Hygiene)."""

import http.client
import json
import os
import re
import threading
import unittest
import urllib.parse

import server


class ServerBackendTest(unittest.TestCase):

  def setUp(self):
    self._orig_env = os.environ.copy()
    self.httpd = server.http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), server.WorkbenchRequestHandler
    )
    self.port = self.httpd.server_address[1]
    self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
    self.thread.start()

  def tearDown(self):
    self.httpd.shutdown()
    self.httpd.server_close()
    os.environ.clear()
    os.environ.update(self._orig_env)

  def _request(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
    req_headers = {"Content-Type": "application/json"}
    if headers:
      req_headers.update(headers)
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    conn.request(method, path, body=payload, headers=req_headers)
    resp = conn.getresponse()
    data = json.loads(resp.read().decode("utf-8"))
    conn.close()
    return resp.status, data

  def _raw(self, method: str, path: str, body: dict | None = None):
    conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    conn.request(method, path, body=payload, headers={"Content-Type": "application/json"})
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp, data

  def test_removed_auth_and_state_routes_return_404_and_never_expose_files(self):
    for method, route, payload in (
        ("GET", "/api/session", None),
        ("GET", "/api/state", None),
        ("POST", "/api/state", {"inputs": {}}),
        ("POST", "/api/auth", {"passcode": "x"}),
        ("POST", "/api/auth/owner", {"pin": "0000"}),
    ):
      status, data = self._request(method, route, payload)
      self.assertEqual(status, 404, f"{method} {route}")
      self.assertIn("error", data)

    # Path confinement: root-level files outside dist/ (e.g. user_state.json, server.py) are never served.
    for blocked in ("/user_state.json", "/../user_state.json", "/server.py"):
      resp, raw = self._raw("GET", blocked)
      text = raw.decode("utf-8", errors="ignore")
      self.assertNotIn("updatedAt", text)
      self.assertNotIn("WorkbenchRequestHandler", text)

  def test_favicon_endpoints_return_svg_200(self):
    for route in ("/favicon.ico", "/favicon.svg"):
      conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
      conn.request("GET", route)
      resp = conn.getresponse()
      body = resp.read().decode("utf-8")
      conn.close()
      self.assertEqual(resp.status, 200)
      self.assertIn("image/svg+xml", resp.getheader("Content-Type", ""))
      self.assertIn("🎚️", body)

      conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
      conn.request("HEAD", route)
      head_resp = conn.getresponse()
      head_resp.read()
      conn.close()
      self.assertEqual(head_resp.status, 200)
      self.assertIn("image/svg+xml", head_resp.getheader("Content-Type", ""))

  def test_cache_control_headers(self):
    resp, _ = self._raw("GET", "/api/health")
    self.assertEqual(resp.getheader("Cache-Control"), "no-store")
    resp, _ = self._raw("GET", "/api/state")
    self.assertEqual(resp.getheader("Cache-Control"), "no-store")
    if not (server.DIST_DIR / "index.html").exists():
      self.skipTest("dist/ not built")
    resp, _ = self._raw("GET", "/")
    self.assertEqual(resp.status, 200)
    self.assertEqual(resp.getheader("Cache-Control"), "no-cache")
    assets = sorted((server.DIST_DIR / "assets").glob("*.js"))
    if assets:
      resp, _ = self._raw("GET", f"/assets/{assets[0].name}")
      self.assertEqual(resp.status, 200)
      self.assertEqual(resp.getheader("Cache-Control"), "public, max-age=31536000, immutable")
    resp, _ = self._raw("GET", "/assets/index-DOESNOTEXIST.js")
    self.assertEqual(resp.status, 404)
    self.assertNotIn("immutable", resp.getheader("Cache-Control", ""))

  def test_vite_dev_server_proxies_api_to_backend(self):
    cfg = (server.BASE_DIR / "vite.config.ts").read_text(encoding="utf-8")
    self.assertRegex(cfg, r"proxy:\s*\{\s*'/api':\s*'http://127\.0\.0\.1:8089'")

  def test_render_crash_is_caught_and_offers_input_reset(self):
    src = server.BASE_DIR / "src"
    main = (src / "main.tsx").read_text(encoding="utf-8")
    self.assertIn("import { ErrorBoundary } from './lib/ErrorBoundary';", main)
    self.assertRegex(main, r"<ErrorBoundary>\s*<App />\s*</ErrorBoundary>")
    boundary = (src / "lib" / "ErrorBoundary.tsx").read_text(encoding="utf-8")
    self.assertIn("getDerivedStateFromError", boundary)
    app_key = re.search(r"LOCAL_INPUTS_KEY = '([^']+)'", (src / "App.tsx").read_text(encoding="utf-8")).group(1)
    self.assertIn(f"const INPUTS_KEY = '{app_key}';", boundary)
    self.assertRegex(boundary, r"setItem\(`\$\{INPUTS_KEY\}_crash_backup`, saved\)[\s\S]*removeItem\(INPUTS_KEY\)")
    self.assertIn("window.location.reload()", boundary)

  def _etf(self, qs: str = ""):
    status, data = self._request("GET", "/api/etf/list" + (f"?{qs}" if qs else ""))
    return status, data

  def test_readonly_etf_database_query_defaults(self):
    status, data = self._etf()
    self.assertEqual(status, 200)
    if not server.ETF_DB_PATH.exists():
      self.skipTest("etf_universe.db not present")
    self.assertEqual(data["count"], 100)
    self.assertEqual(len(data["items"]), 100)
    self.assertGreater(data["total"], 1000)
    first = data["items"][0]
    for key in ("ticker", "name", "market", "category", "expenseRatio", "actualExpenseRatio",
                "dividendYield", "dividendCycle", "expectedGrowthRate", "productType", "aumKrw",
                "eligibleIsa", "eligiblePension", "underlyingIndex", "issuer", "isEstimated"):
      self.assertIn(key, first)
    aums = [it["aumKrw"] for it in data["items"]]
    self.assertEqual(aums, sorted(aums, reverse=True))

  def test_etf_list_search_market_category_filters(self):
    if not server.ETF_DB_PATH.exists():
      self.skipTest("etf_universe.db not present")
    status, data = self._etf("q=SCHD")
    self.assertEqual(status, 200)
    self.assertGreaterEqual(data["total"], 1)
    self.assertEqual(data["items"][0]["ticker"], "SCHD")
    for it in data["items"]:
      hay = " ".join([it["ticker"], it["name"], it["underlyingIndex"], it["issuer"]]).upper()
      self.assertIn("SCHD", hay)
    status, alias = self._etf("query=SCHD")
    self.assertEqual(alias["total"], data["total"])
    status, kr = self._etf("q=" + urllib.parse.quote("미국배당다우존스"))
    self.assertGreaterEqual(kr["total"], 3)
    self.assertTrue(all(it["market"] == "KRX" for it in kr["items"]))
    status, us = self._etf("market=US&limit=300")
    self.assertEqual(status, 200)
    self.assertTrue(all(it["market"] == "US" for it in us["items"]))
    self.assertTrue(all(it["eligibleIsa"] is False and it["eligiblePension"] is False for it in us["items"]))
    status, div = self._etf("category=DIVIDEND&limit=300")
    self.assertEqual(div["total"], 21)
    self.assertTrue(all(it["category"] in ("DIVIDEND", "VALUE") for it in div["items"]))
    status, bg = self._etf("category=BOND_GOLD&limit=300")
    self.assertTrue(all(it["category"] in ("BOND", "CASH_EQUIV", "COMMODITY", "REAL_ESTATE") for it in bg["items"]))
    aums = [it["aumKrw"] for it in bg["items"]]
    self.assertEqual(aums, sorted(aums, reverse=True))
    status, big = self._etf("limit=999")
    self.assertEqual(big["count"], 300)

  def test_etf_list_rejects_bad_params_and_injection(self):
    for qs in ("limit=abc", "limit=-1", "limit=0", "market=XX", "category=NOPE"):
      status, data = self._etf(qs)
      self.assertEqual(status, 400, qs)
      self.assertIn("error", data)
    if not server.ETF_DB_PATH.exists():
      self.skipTest("etf_universe.db not present")
    status, inj = self._etf("q=" + urllib.parse.quote("' OR 1=1 --"))
    self.assertEqual(status, 200)
    self.assertEqual(inj["total"], 0)

  def test_etf_list_tickers_lookup_preserves_order_and_flags_estimates(self):
    if not server.ETF_DB_PATH.exists():
      self.skipTest("etf_universe.db not present")
    status, data = self._etf("tickers=SCHD,VOO,360750")
    self.assertEqual(status, 200)
    self.assertEqual([it["ticker"] for it in data["items"]], ["SCHD", "VOO", "360750"])
    self.assertEqual(data["total"], 3)
    status, all_rows = self._etf("limit=300&category=ALL")
    for it in all_rows["items"]:
      expected = it["expectedGrowthRate"] == 4.5 and it["dividendYield"] == 2.0
      self.assertEqual(it["isEstimated"], expected, it["ticker"])
    status, ov = self._etf("tickers=273130,292150,069500")
    self.assertEqual(status, 200)
    by_ticker = {it["ticker"]: it for it in ov["items"]}
    if "273130" in by_ticker:
      self.assertEqual(by_ticker["273130"]["expectedGrowthRate"], 0.8)
      self.assertEqual(by_ticker["273130"]["dividendYield"], 3.4)
      self.assertEqual(by_ticker["273130"]["expenseRatio"], 0.045)
      self.assertFalse(by_ticker["273130"]["isEstimated"])
    if "292150" in by_ticker:
      self.assertEqual(by_ticker["292150"]["category"], "KR_INDEX")
      self.assertEqual(by_ticker["292150"]["expectedGrowthRate"], 5.5)
      self.assertEqual(by_ticker["292150"]["dividendYield"], 2.5)
      self.assertFalse(by_ticker["292150"]["isEstimated"])
    if "069500" in by_ticker:
      self.assertEqual(by_ticker["069500"]["expectedGrowthRate"], 5.0)
      self.assertEqual(by_ticker["069500"]["dividendYield"], 2.0)

  def test_portfolio_presets_reference_only_existing_tickers(self):
    preset_file = server.BASE_DIR / "src" / "engine" / "portfolioPresets.ts"
    if not preset_file.exists():
      self.skipTest("portfolioPresets.ts not created yet")
    if not server.ETF_DB_PATH.exists():
      self.skipTest("etf_universe.db not present")
    tickers = sorted(set(re.findall(r"ticker:\s*'([A-Z0-9]+)'", preset_file.read_text(encoding="utf-8"))))
    self.assertTrue(tickers)
    self.assertNotIn("448290", tickers)
    rows = server.fetch_etf_list(tickers=tickers)
    self.assertEqual(sorted(r["ticker"] for r in rows["items"]), tickers)

  def test_default_bind_host_is_loopback_unless_overridden(self):
    orig_host = os.environ.pop("HOST", None)
    try:
      if not server.ENV_FILE.exists():
        self.assertEqual(server._resolve_host(["server.py"]), "127.0.0.1")
      self.assertEqual(server._resolve_host(["server.py", "--host", "0.0.0.0"]), "0.0.0.0")
      self.assertEqual(server._resolve_host(["server.py", "--host=127.0.0.1"]), "127.0.0.1")
    finally:
      if orig_host is not None:
        os.environ["HOST"] = orig_host

  def test_no_passcode_hint_or_plaintext_fallback_in_repo(self):
    for p in server.BASE_DIR.rglob("*"):
      if not p.is_file() or p.suffix not in (".py", ".ts", ".tsx", ".html") or "node_modules" in p.parts:
        continue
      if p.name == "test_server.py":
        continue
      content = p.read_text(encoding="utf-8")
      self.assertNotRegex(
          content,
          r"(?i)(Passcode:\s*ldap|<passcode>:<ldap>)",
          f"Passcode hint pattern leaked in {p}",
      )


if __name__ == "__main__":
  unittest.main()
