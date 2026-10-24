"""Cliente mínimo da API v2 do VHSYS da Rey Festas.

Autenticação: VHSYS_ACCESS_TOKEN e VHSYS_SECRET_ACCESS_TOKEN, os tokens do app
"Integração via API" da conta da Rey Festas. Use um ambiente só da Rey Festas para
que esses nomes nunca apontem para a conta de outra empresa.

Documentação: https://developers.vhsys.com.br/api/
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("VHSYS_BASE_URL", "https://api.vhsys.com/v2")
LIMITE_PAGINA = 250  # máximo da API

# O VHSYS responde 403 "Nenhuma ... encontrada" em vez de uma lista vazia.
SEM_RESULTADO = re.compile(r"Nenhum[a]? .{0,40}encontrad[oa]", re.IGNORECASE)


class ErroVhsys(Exception):
    """Falha de comunicação ou resposta de erro do VHSYS."""


def _headers():
    h = {"User-Agent": "ReyFestas/1.0", "Cache-Control": "no-cache",
         "Content-Type": "application/json"}
    for header, var in (("access-token", "VHSYS_ACCESS_TOKEN"),
                        ("secret-access-token", "VHSYS_SECRET_ACCESS_TOKEN")):
        if os.environ.get(var):
            h[header] = os.environ[var]
    return h


def _chamar(metodo, caminho, params=None, body=None):
    url = f"{BASE_URL}{caminho}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    dados = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        corpo = e.read()[:300]
        if metodo == "GET" and e.code == 403 and SEM_RESULTADO.search(corpo.decode("utf-8", "replace")):
            return {"status": "success", "data": [], "paging": {"total": 0}}
        raise ErroVhsys(f"{metodo} {caminho}: HTTP {e.code} {corpo!r}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise ErroVhsys(f"{metodo} {caminho}: {e}") from e


def _todas(params, caminho):
    """Todas as páginas de uma listagem."""
    itens, offset = [], 0
    while True:
        corpo = _chamar("GET", caminho, {**params, "limit": LIMITE_PAGINA, "offset": offset})
        if not corpo or corpo.get("status") != "success":
            return itens
        pagina = corpo.get("data") or []
        if isinstance(pagina, dict):
            pagina = [pagina]
        itens.extend(pagina)
        offset += len(pagina)
        if not pagina or offset >= int((corpo.get("paging") or {}).get("total", 0)):
            return itens
