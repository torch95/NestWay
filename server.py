#!/usr/bin/env python3
"""Minimal stateless stdlib HTTP backend for NestWay Slider (:8089)."""

import http.server
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import urllib.parse

BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
ENV_FILE = BASE_DIR / ".env"
ETF_DB_PATH = BASE_DIR / "etf_universe.db"


def read_env_value(key: str, default: str = "") -> str:
  val = os.environ.get(key, "").strip()
  if val:
    return val
  if ENV_FILE.exists():
    try:
      for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
          continue
        k, v = line.split("=", 1)
        if k.strip() == key:
          return v.strip().strip('"').strip("'")
    except OSError:
      pass
  return default


ETF_CATEGORY_GROUPS: dict[str, tuple[str, ...]] = {
    "ALL": (),
    "INDEX": ("US_INDEX", "KR_INDEX", "TECH", "GROWTH", "GLOBAL_INDEX", "DEVELOPED", "EMERGING", "SECTOR"),
    "DIVIDEND": ("DIVIDEND", "VALUE"),
    "COVERED_CALL": ("COVERED_CALL",),
    "BOND_GOLD": ("BOND", "CASH_EQUIV", "COMMODITY", "REAL_ESTATE"),
}
ETF_MARKETS = ("ALL", "US", "KRX")
ETF_DEFAULT_LIMIT = 100
ETF_MAX_LIMIT = 300
ETF_MAX_TICKERS = 20
# Rows the collector could not enrich carry this placeholder pair (expected_growth 4.5 / dividend_yield 2.0).
ETF_PLACEHOLDER_GROWTH = 4.5
ETF_PLACEHOLDER_DIVIDEND = 2.0

_KNOWN_TICKER_OVERRIDES: dict[str, dict] = {
    "273130": {
        "expectedGrowthRate": 0.8,
        "dividendYield": 3.4,
        "expenseRatio": 0.045,
        "actualExpenseRatio": 0.07,
    },
    "292150": {
        "category": "KR_INDEX",
        "expectedGrowthRate": 5.5,
        "dividendYield": 2.5,
        "expenseRatio": 0.15,
        "actualExpenseRatio": 0.22,
    },
    "069500": {
        "expectedGrowthRate": 5.0,
        "dividendYield": 2.0,
    },
}


class EtfQueryError(ValueError):
  """Raised for malformed /api/etf/list parameters (maps to HTTP 400)."""


def _etf_row_to_item(r: sqlite3.Row) -> dict:
  growth = float(r["expected_growth"] or 0.0)
  div = float(r["dividend_yield"] or 0.0)
  item = {
      "ticker": r["ticker"],
      "name": r["name"],
      "market": r["market"],
      "category": r["category"],
      "expenseRatio": float(r["expense_ratio"] or 0.0),
      "actualExpenseRatio": float(r["actual_expense_ratio"] or r["expense_ratio"] or 0.0),
      "dividendYield": div,
      "dividendCycle": r["dividend_cycle"] or "Quarterly",
      "expectedGrowthRate": growth,
      "productType": r["product_type"] or "other",
      "aumKrw": float(r["aum_krw"] or 0.0),
      "eligibleIsa": bool(r["eligible_isa"]),
      "eligiblePension": bool(r["eligible_pension"]),
      "underlyingIndex": r["underlying_index"] or "",
      "issuer": r["issuer"] or "",
  }
  override = _KNOWN_TICKER_OVERRIDES.get(str(r["ticker"] or "").upper())
  if override:
    item.update(override)
  item["isEstimated"] = (
      item["expectedGrowthRate"] == ETF_PLACEHOLDER_GROWTH
      and item["dividendYield"] == ETF_PLACEHOLDER_DIVIDEND
  )
  return item


_ETF_SELECT = """
    SELECT ticker, name, market, category, expense_ratio, actual_expense_ratio,
           dividend_yield, dividend_cycle, expected_growth, product_type, aum_krw,
           eligible_isa, eligible_pension, underlying_index, issuer
    FROM etf_master
"""


def parse_etf_query(params: dict) -> dict:
  """Validates raw query-string params (first value of each key) into fetch_etf_list kwargs."""
  def first(key: str) -> str | None:
    v = params.get(key)
    if isinstance(v, list):
      v = v[0] if v else None
    return v.strip() if isinstance(v, str) and v.strip() else None

  q = first("q") or first("query")
  market = (first("market") or "ALL").upper()
  if market == "KR":
    market = "KRX"
  if market not in ETF_MARKETS:
    raise EtfQueryError(f"market must be one of {ETF_MARKETS}")
  category = (first("category") or "ALL").upper()
  if category not in ETF_CATEGORY_GROUPS:
    raise EtfQueryError(f"category must be one of {tuple(ETF_CATEGORY_GROUPS)}")
  raw_limit = first("limit")
  limit = ETF_DEFAULT_LIMIT
  if raw_limit is not None:
    if not raw_limit.isdigit() or int(raw_limit) <= 0:
      raise EtfQueryError("limit must be a positive integer")
    limit = min(int(raw_limit), ETF_MAX_LIMIT)
  tickers = None
  raw_tickers = first("tickers")
  if raw_tickers:
    tickers = [t.strip().upper() for t in raw_tickers.split(",") if t.strip()]
    if not tickers or len(tickers) > ETF_MAX_TICKERS:
      raise EtfQueryError(f"tickers must contain 1..{ETF_MAX_TICKERS} symbols")
    if any(not re.fullmatch(r"[A-Z0-9.\-]{1,12}", t) for t in tickers):
      raise EtfQueryError("tickers contain an invalid symbol")
  return {"q": q[:64] if q else None, "market": market, "category": category, "limit": limit, "tickers": tickers}


def fetch_etf_list(
    db_path: Path | None = None,
    *,
    q: str | None = None,
    market: str = "ALL",
    category: str = "ALL",
    limit: int = ETF_DEFAULT_LIMIT,
    tickers: list[str] | None = None,
) -> dict:
  """Read-only, parameterized query against etf_master."""
  target = db_path or ETF_DB_PATH
  if not target.exists():
    return {"items": [], "count": 0, "total": 0}
  uri = f"file:{urllib.parse.quote(str(target))}?mode=ro"
  conn = sqlite3.connect(uri, uri=True, timeout=5.0)
  conn.row_factory = sqlite3.Row
  try:
    if tickers:
      wanted = [t.upper() for t in tickers][:ETF_MAX_TICKERS]
      placeholders = ",".join("?" for _ in wanted)
      rows = conn.execute(f"{_ETF_SELECT} WHERE upper(ticker) IN ({placeholders})", wanted).fetchall()
      by_ticker = {r["ticker"].upper(): _etf_row_to_item(r) for r in rows}
      items = [by_ticker[t] for t in wanted if t in by_ticker]
      return {"items": items, "count": len(items), "total": len(items)}

    where: list[str] = []
    args: list = []
    if q:
      like = f"%{q}%"
      where.append("(ticker LIKE ? OR name LIKE ? OR underlying_index LIKE ? OR issuer LIKE ?)")
      args.extend([like, like, like, like])
    if market != "ALL":
      where.append("market = ?")
      args.append(market)
    cats = ETF_CATEGORY_GROUPS.get(category, ())
    if cats:
      where.append(f"category IN ({','.join('?' for _ in cats)})")
      args.extend(cats)
    where_sql = f" WHERE {' AND '.join(where)}" if where else ""
    total = conn.execute(f"SELECT COUNT(*) FROM etf_master{where_sql}", args).fetchone()[0]
    safe_limit = max(1, min(int(limit), ETF_MAX_LIMIT))
    order_sql = "ORDER BY (upper(ticker) = ?) DESC, aum_krw DESC, ticker ASC" if q else "ORDER BY aum_krw DESC, ticker ASC"
    order_args = [q.upper()] if q else []
    rows = conn.execute(
        f"{_ETF_SELECT}{where_sql} {order_sql} LIMIT ?", [*args, *order_args, safe_limit]
    ).fetchall()
    items = [_etf_row_to_item(r) for r in rows]
    return {"items": items, "count": len(items), "total": int(total)}
  finally:
    conn.close()


class WorkbenchRequestHandler(http.server.SimpleHTTPRequestHandler):
  """Serves read-only ETF API endpoints and SPA static files from DIST_DIR."""

  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(DIST_DIR), **kwargs)

  def send_response(self, code, message=None):
    self._status_code = code
    super().send_response(code, message)

  def end_headers(self):
    self.send_header("X-Content-Type-Options", "nosniff")
    self.send_header("X-Frame-Options", "SAMEORIGIN")
    path = urllib.parse.urlparse(self.path).path
    if path.startswith("/api/"):
      self.send_header("Cache-Control", "no-store")
    elif path.startswith("/assets/") and getattr(self, "_status_code", 0) in (200, 304):
      self.send_header("Cache-Control", "public, max-age=31536000, immutable")
    else:
      self.send_header("Cache-Control", "no-cache")
    super().end_headers()

  def _send_json(self, status: int, payload: dict, headers: dict | None = None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    for k, v in (headers or {}).items():
      self.send_header(k, v)
    self.end_headers()
    self.wfile.write(body)

  def translate_path(self, path: str) -> str:
    resolved = Path(super().translate_path(path)).resolve()
    dist_resolved = DIST_DIR.resolve()
    if not str(resolved).startswith(str(dist_resolved)):
      return str(dist_resolved / "index.html")
    return str(resolved)

  def _send_favicon(self, send_body: bool = True):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\xf0\x9f\x8e\x9a\xef\xb8\x8f</text></svg>'
    self.send_response(200)
    self.send_header("Content-Type", "image/svg+xml")
    self.send_header("Content-Length", str(len(svg)))
    self.end_headers()
    if send_body:
      self.wfile.write(svg)

  def do_HEAD(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path in ("/favicon.ico", "/favicon.svg"):
      return self._send_favicon(send_body=False)
    return super().do_HEAD()

  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    route = parsed.path

    if route in ("/favicon.ico", "/favicon.svg"):
      return self._send_favicon(send_body=True)

    if route == "/api/health":
      return self._send_json(200, {"status": "ok", "port": getattr(self.server, "server_port", 8089)})

    if route == "/api/etf/list":
      try:
        kwargs = parse_etf_query(urllib.parse.parse_qs(parsed.query, keep_blank_values=False))
      except EtfQueryError as exc:
        return self._send_json(400, {"error": str(exc)})
      return self._send_json(200, fetch_etf_list(**kwargs))

    if route.startswith("/api/"):
      return self._send_json(404, {"error": "Not found"})

    if not DIST_DIR.exists():
      return self._send_json(503, {"error": "Frontend build not ready"})
    return super().do_GET()

  def do_POST(self):
    return self._send_json(404, {"error": "Not found"})


def _resolve_port(argv: list[str]) -> int:
  for idx, arg in enumerate(argv[1:], start=1):
    if arg == "--port" and idx + 1 < len(argv) and argv[idx + 1].isdigit():
      return int(argv[idx + 1])
    if arg.startswith("--port=") and arg.split("=", 1)[1].isdigit():
      return int(arg.split("=", 1)[1])
    if idx == 1 and arg.isdigit():
      return int(arg)
  port_val = read_env_value("PORT", "8089")
  return int(port_val) if port_val.isdigit() else 8089


def _resolve_host(argv: list[str]) -> str:
  for idx, arg in enumerate(argv[1:], start=1):
    if arg == "--host" and idx + 1 < len(argv) and argv[idx + 1].strip():
      return argv[idx + 1].strip()
    if arg.startswith("--host=") and arg.split("=", 1)[1].strip():
      return arg.split("=", 1)[1].strip()
  return read_env_value("HOST", "127.0.0.1") or "127.0.0.1"


def main():
  host = _resolve_host(sys.argv)
  port = _resolve_port(sys.argv)
  server = http.server.ThreadingHTTPServer((host, port), WorkbenchRequestHandler)
  print(f"[nestway_slider] Serving on http://{host}:{port}")
  server.serve_forever()


if __name__ == "__main__":
  main()
