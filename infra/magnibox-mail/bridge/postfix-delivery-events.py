#!/usr/bin/env python3
"""Forward Postfix SMTP delivery outcomes to the signed MAGNIBOX receipt API."""
from __future__ import annotations
import hashlib, hmac, json, os, re, signal, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlparse

LINE_RE = re.compile(r"postfix/smtp\\[\\d+\\]:\\s+(?P<queue>[A-F0-9]{5,20}):\\s+to=<(?P<recipient>[^>\\r\\n]+)>,.*?\\bstatus=(?P<status>sent|bounced|deferred|expired)\\b", re.IGNORECASE)
EVENTS = {"sent":"remote_accepted","bounced":"bounced","deferred":"deferred","expired":"failed"}
STOP = False

def parse_log_line(line: str):
    match = LINE_RE.search(line)
    if not match: return None
    queue_id = match.group("queue").upper()
    recipient = match.group("recipient").strip().lower()
    event = EVENTS[match.group("status").lower()]
    event_id = hashlib.sha256(f"{queue_id}\x1f{recipient}\x1f{event}".encode("utf-8")).hexdigest()
    return {"queueId": queue_id, "recipient": recipient, "eventId": event_id, "event": event}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def send_event(payload, endpoint, secret):
    encoded=json.dumps(payload,separators=(",",":"),ensure_ascii=True).encode("ascii")
    timestamp=str(int(time.time()))
    signature=hmac.new(secret.encode(),timestamp.encode()+b"."+encoded,hashlib.sha256).hexdigest()
    request=urllib.request.Request(endpoint,data=encoded,headers={
        "Content-Type":"application/json","x-magnibox-timestamp":timestamp,
        "x-magnibox-signature":"sha256="+signature},method="POST")
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=10) as response:
            return response.status==202
    except (urllib.error.URLError,TimeoutError,OSError,urllib.error.HTTPError):
        return False

def load_cursor(path:Path,inode:int,size:int)->int:
    try:
        saved=json.loads(path.read_text(encoding="utf-8"))
        if saved.get("inode")==inode and isinstance(saved.get("offset"),int):
            offset=saved["offset"]
            return offset if 0 <= offset <= size else 0
    except (OSError,ValueError,AttributeError): pass
    return 0

def save_cursor(path:Path,inode:int,offset:int)->None:
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=".magnibox-cursor-",dir=path.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as handle:
            json.dump({"inode":inode,"offset":offset},handle); handle.flush(); os.fsync(handle.fileno())
        os.replace(temp,path)
    finally:
        try: os.unlink(temp)
        except FileNotFoundError: pass

def read_complete_line(log)->str|None:
    """Return only newline-terminated records; retain partial writes for the next poll."""
    start=log.tell()
    line=log.readline()
    if not line or not line.endswith("\n"):
        log.seek(start)
        return None
    return line

def follow(log_path:Path,cursor_path:Path,endpoint:str,secret:str)->int:
    global STOP
    parsed=urlparse(endpoint)
    if parsed.scheme!="https" or not parsed.hostname or len(secret)<32: return 78
    backoff=1
    while not STOP:
        try:
            with log_path.open("r",encoding="utf-8",errors="replace") as log:
                stat=os.fstat(log.fileno()); offset=load_cursor(cursor_path,stat.st_ino,stat.st_size); log.seek(offset)
                while not STOP:
                    line_start=log.tell()
                    line=read_complete_line(log)
                    if line is None:
                        time.sleep(0.5)
                        try:
                            current=log_path.stat()
                            if current.st_ino!=stat.st_ino or current.st_size<log.tell(): break
                        except OSError: break
                        continue
                    event=parse_log_line(line)
                    if event and not send_event(event,endpoint,secret):
                        time.sleep(backoff); backoff=min(backoff*2,60)
                        log.seek(line_start)
                        continue
                    backoff=1; save_cursor(cursor_path,stat.st_ino,log.tell())
        except OSError: time.sleep(2)
    return 0

def main()->int:
    if len(sys.argv)!=3: return 64
    signal.signal(signal.SIGTERM,lambda *_: globals().__setitem__("STOP",True))
    signal.signal(signal.SIGINT,lambda *_: globals().__setitem__("STOP",True))
    return follow(Path(sys.argv[1]),Path(sys.argv[2]),os.environ.get("MAGNIBOX_DELIVERY_EVENT_URL","").strip(),os.environ.get("MAGNIBOX_DELIVERY_EVENT_WEBHOOK_SECRET",""))

if __name__=="__main__": raise SystemExit(main())
