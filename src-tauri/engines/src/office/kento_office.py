# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Mehmet Burak Taşkaya
"""Kento's office client: one request to the LibreOffice that Kento keeps running.

LibreOffice's own Python runs it (it needs pyuno), with Kento's arguments:

    kento_office.py convert --pipe=NAME --wait=SECONDS --input=URL --output=URL
                            [--load=NAME:TYPE:VALUE ...] [--store=NAME:TYPE:VALUE ...]
    kento_office.py stop --pipe=NAME --wait=SECONDS

Kento chooses every property (TYPE is bool, short or string); this script only hands them to
LibreOffice. It connects through a named pipe on this computer, never a network socket, and
waits up to SECONDS for LibreOffice to open it. On standard error it says when it is connected
and, in one line, what went wrong; it answers with its exit code (the numbers below, which Kento
reads).
"""

import sys
import time

OK = 0
OTHER = 1
USAGE = 2
NO_UNO = 3
NO_CONNECTION = 4
UNREADABLE = 5
BROKEN = 6


def say(kind, message):
    """One line on standard error, in UTF-8 whatever the console's code page."""
    text = " ".join(str(message).split()) or "no message"
    sys.stderr.buffer.write(("kento-office: %s: %s\n" % (kind, text)).encode("utf-8", "replace"))
    sys.stderr.flush()


def parse(argv):
    """The action and its --key=value arguments; --load and --store may repeat."""
    if not argv or argv[0] not in ("convert", "stop"):
        return None
    request = {"action": argv[0], "load": [], "store": []}
    for arg in argv[1:]:
        if not arg.startswith("--") or "=" not in arg:
            return None
        key, value = arg[2:].split("=", 1)
        if key in ("load", "store"):
            parts = value.split(":", 2)
            if len(parts) != 3 or parts[1] not in ("bool", "short", "string"):
                return None
            request[key].append(tuple(parts))
        elif key in ("pipe", "wait", "input", "output"):
            request[key] = value
        else:
            return None
    needed = ("pipe", "wait", "input", "output") if argv[0] == "convert" else ("pipe", "wait")
    if any(key not in request for key in needed):
        return None
    try:
        request["wait"] = float(request["wait"])
    except ValueError:
        return None
    return request


def value(kind, text):
    if kind == "bool":
        return text == "true"
    if kind == "short":
        return int(text)
    return text


def properties(uno, items):
    from com.sun.star.beans import PropertyValue

    result = []
    for name, kind, text in items:
        prop = PropertyValue()
        prop.Name = name
        prop.Value = value(kind, text)
        result.append(prop)
    return tuple(result)


def connect(uno, pipe, wait):
    """The office's component context, once LibreOffice listens on the pipe."""
    from com.sun.star.connection import NoConnectException

    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local
    )
    url = "uno:pipe,name=%s;urp;StarOffice.ComponentContext" % pipe
    deadline = time.monotonic() + wait
    while True:
        try:
            return resolver.resolve(url)
        except NoConnectException:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


def convert(uno, desktop, request):
    from com.sun.star.io import IOException
    from com.sun.star.lang import IllegalArgumentException

    try:
        document = desktop.loadComponentFromURL(
            request["input"], "_blank", 0, properties(uno, request["load"])
        )
    except (IOException, IllegalArgumentException) as error:
        say("unreadable", "could not be loaded: %s" % error.Message)
        return UNREADABLE
    if document is None:
        say("unreadable", "could not be loaded")
        return UNREADABLE
    try:
        document.storeToURL(request["output"], properties(uno, request["store"]))
    except IOException as error:
        say("error", "could not be written: %s" % error.Message)
        return OTHER
    finally:
        try:
            document.close(True)
        except Exception:
            document.dispose()
    return OK


def main(argv):
    request = parse(argv)
    if request is None:
        say("usage", "unexpected arguments")
        return USAGE
    try:
        import uno
        from com.sun.star.connection import NoConnectException
        from com.sun.star.lang import DisposedException
    except ImportError as error:
        say("no-uno", error)
        return NO_UNO
    try:
        context = connect(uno, request["pipe"], request["wait"])
    except NoConnectException as error:
        say("no-connection", error.Message)
        return NO_CONNECTION
    say("connected", request["pipe"])
    try:
        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        if request["action"] == "stop":
            try:
                desktop.terminate()
            except DisposedException:
                pass  # LibreOffice may close the connection before it answers.
            return OK
        return convert(uno, desktop, request)
    except DisposedException as error:
        say("broken", error.Message)
        return BROKEN
    except Exception as error:
        say("error", getattr(error, "Message", None) or error)
        return OTHER


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
