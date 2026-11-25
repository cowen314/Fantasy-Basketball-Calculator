from fbc import fetch


class FakeResponse:
    status_code = 200
    encoding = "ISO-8859-1"  # what requests guesses when no charset is sent

    def __init__(self, body: str):
        self.content = body.encode("utf-8")

    def raise_for_status(self):
        pass


def test_pages_decoded_as_utf8(monkeypatch):
    monkeypatch.setattr(fetch, "REQUEST_INTERVAL", 0)
    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: FakeResponse("Nikola Jokić, Luka Dončić"))
    assert fetch._get("https://example.invalid") == "Nikola Jokić, Luka Dončić"
