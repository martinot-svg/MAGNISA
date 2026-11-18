#!/usr/bin/env python3
"""Fetch a signed MAGNIBOX recipient snapshot and publish versioned Postfix maps."""
from __future__ import annotations
import hashlib, hmac, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from urllib.parse import urlparse

DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
LOCAL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

def sign_request(body: bytes, timestamp: str, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode()+b"."+body, hashlib.sha256).hexdigest()

def verify_response(body: bytes, timestamp: str | None, signature: str | None, secret: str, now: int | None = None) -> bool:
    current = int(time.time()) if now is None else now
    if not timestamp or not re.fullmatch(r"\d{10}", timestamp) or abs(current-int(timestamp)) > 300:
        return False
    if not signature or not re.fullmatch(r"sha256=[a-f0-9]{64}", signature, re.I):
        return False
    expected = sign_request(body, timestamp, secret)
    return hmac.compare_digest(expected.lower(), signature.lower())

def validate_snapshot(value: object) -> dict:
    if not isinstance(value, dict): raise ValueError("snapshot must be an object")
    domains, recipients, revision = value.get("domains"), value.get("recipients"), value.get("revision")
    if not isinstance(domains,list) or not isinstance(recipients,list) or not isinstance(revision,str):
        raise ValueError("snapshot fields missing")
    if len(domains)>10000 or len(recipients)>10000: raise ValueError("snapshot too large")
    if any(not isinstance(x,str) or not DOMAIN_RE.fullmatch(x) for x in domains):
        raise ValueError("invalid domain in snapshot")
    if any(not isinstance(x,str) or x.count("@")!=1 for x in recipients):
        raise ValueError("invalid recipient in snapshot")
    for address in recipients:
        local, domain = address.split("@")
        if not LOCAL_RE.fullmatch(local) or not DOMAIN_RE.fullmatch(domain) or domain not in domains:
            raise ValueError("recipient does not belong to an approved domain")
    if domains != sorted(set(domains)) or recipients != sorted(set(recipients)):
        raise ValueError("snapshot entries must be unique and sorted")
    expected = hashlib.sha256(json.dumps({"domains":domains,"recipients":recipients},separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}",revision) or not hmac.compare_digest(expected,revision):
        raise ValueError("snapshot revision mismatch")
    return {"domains":domains,"recipients":recipients,"revision":revision,"generatedAt":value.get("generatedAt")}

def fetch_snapshot(endpoint: str, secret: str) -> dict:
    parsed=urlparse(endpoint)
    if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or len(secret)<32:
        raise ValueError("HTTPS endpoint and a 32-character secret are required")
    body=b"{}"; timestamp=str(int(time.time()))
    request=urllib.request.Request(endpoint,data=body,headers={
        "Content-Type":"application/json","x-magnibox-timestamp":timestamp,
        "x-magnibox-signature":sign_request(body,timestamp,secret)},method="POST")
    with urllib.request.build_opener(NoRedirect).open(request,timeout=15) as response:
        raw=response.read(2_000_001)
        if response.status!=200 or len(raw)>2_000_000: raise ValueError("invalid provisioning response size/status")
        if not verify_response(raw,response.headers.get("x-magnibox-timestamp"),
                               response.headers.get("x-magnibox-signature"),secret):
            raise ValueError("provisioning response signature invalid or expired")
        snapshot=validate_snapshot(json.loads(raw))
        if response.headers.get("x-magnibox-revision") != snapshot["revision"]:
            raise ValueError("provisioning revision header mismatch")
        return snapshot

def render_maps(snapshot: dict) -> tuple[str,str]:
    domains="".join(f"{domain} OK\n" for domain in snapshot["domains"])
    recipients="".join(f"{address} magnibox/\n" for address in snapshot["recipients"])
    return domains,recipients

def publish_maps(snapshot: dict, output: Path, postmap: str = "postmap") -> Path:
    output.mkdir(parents=True,exist_ok=True)
    revision=snapshot["revision"]
    generation=output/revision
    if generation.exists():
        # A revision directory is immutable. Never silently reuse a partial or
        # damaged generation left by an interrupted/older synchronizer.
        required = ("domains", "domains.db", "recipients", "recipients.db", "manifest.json")
        if not generation.is_dir() or any(not (generation / name).is_file() for name in required):
            raise ValueError("existing provisioning generation is incomplete")
        manifest = json.loads((generation / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("revision") != revision:
            raise ValueError("existing provisioning generation revision mismatch")
    else:
        stage=Path(tempfile.mkdtemp(prefix=".magnibox-stage-",dir=output))
        try:
            domains,recipients=render_maps(snapshot)
            (stage/"domains").write_text(domains,encoding="ascii")
            (stage/"recipients").write_text(recipients,encoding="ascii")
            (stage/"manifest.json").write_text(json.dumps({
                "revision":revision,"generatedAt":snapshot.get("generatedAt"),
                "domainCount":len(snapshot["domains"]),"recipientCount":len(snapshot["recipients"])
            },separators=(",",":")),encoding="utf-8")
            subprocess.run([postmap,"hash:"+str(stage/"domains")],check=True,timeout=30)
            subprocess.run([postmap,"hash:"+str(stage/"recipients")],check=True,timeout=30)
            if not (stage/"domains.db").is_file() or not (stage/"recipients.db").is_file():
                raise ValueError("postmap did not produce both indexed maps")
            # Directory rename is atomic on this filesystem. If another
            # synchronizer won the same revision race, accept only its complete
            # immutable generation; never overwrite it.
            try:
                os.rename(stage,generation)
            except FileExistsError:
                required = ("domains", "domains.db", "recipients", "recipients.db", "manifest.json")
                if not generation.is_dir() or any(not (generation / name).is_file() for name in required):
                    raise ValueError("concurrent provisioning generation is incomplete")
                manifest = json.loads((generation / "manifest.json").read_text(encoding="utf-8"))
                if manifest.get("revision") != revision:
                    raise ValueError("concurrent provisioning generation revision mismatch")
        except Exception:
            import shutil
            shutil.rmtree(stage,ignore_errors=True)
            raise
    link_tmp=output/(".current-"+str(os.getpid()))
    try:
        if link_tmp.exists() or link_tmp.is_symlink(): link_tmp.unlink()
        os.symlink(revision,link_tmp)
        os.replace(link_tmp,output/"current")
    finally:
        if link_tmp.exists() or link_tmp.is_symlink(): link_tmp.unlink()
    return generation

def main()->int:
    if len(sys.argv)!=2: return 64
    endpoint=os.environ.get("MAGNIBOX_PROVISIONING_URL","").strip()
    secret=os.environ.get("MAGNIBOX_PROVISIONING_WEBHOOK_SECRET","")
    try:
        snapshot=fetch_snapshot(endpoint,secret)
        generation=publish_maps(snapshot,Path(sys.argv[1]))
        print(f"Prepared MAGNIBOX Postfix map revision {snapshot['revision']} at {generation}")
        print("Maps are staged only. Review Postfix virtual-domain/recipient routing and explicitly reload Postfix in the pilot.")
        return 0
    except (OSError,ValueError,urllib.error.URLError,subprocess.SubprocessError,json.JSONDecodeError) as error:
        print(f"MAGNIBOX provisioning sync failed: {type(error).__name__}",file=sys.stderr)
        return 1

if __name__=="__main__": raise SystemExit(main())
