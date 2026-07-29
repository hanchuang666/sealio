#!/usr/bin/env python3
import cgi
import json
import mimetypes
import os
import shutil
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse


DATA_DIR = os.environ.get("SEALIO_DATA_DIR", "/var/lib/sealio")
STAMP_DIR = os.path.join(DATA_DIR, "stamps")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
STAMP_INDEX = os.path.join(DATA_DIR, "stamps.json")
MAX_UPLOAD_BYTES = int(os.environ.get("SEALIO_MAX_UPLOAD_BYTES", str(80 * 1024 * 1024)))
UPLOAD_TTL_SECONDS = int(os.environ.get("SEALIO_UPLOAD_TTL_SECONDS", str(24 * 60 * 60)))

STAMP_EXTENSIONS = set(["png", "jpg", "jpeg"])
DOCUMENT_EXTENSIONS = set(["pdf", "png", "jpg", "jpeg"])


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def ensure_storage():
    for path in [DATA_DIR, STAMP_DIR, UPLOAD_DIR]:
        if not os.path.exists(path):
            os.makedirs(path)
    if not os.path.exists(STAMP_INDEX):
        write_json_file(STAMP_INDEX, [])


def read_json_file(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return fallback


def write_json_file(path, payload):
    temp_path = path + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)


def extension_for_name(name):
    _, ext = os.path.splitext(name or "")
    return ext.lower().lstrip(".")


def mime_for_name(name):
    mime_type, _ = mimetypes.guess_type(name)
    return mime_type or "application/octet-stream"


def cleanup_uploads():
    now = time.time()
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if not os.path.isfile(path):
            continue
        try:
            if now - os.path.getmtime(path) > UPLOAD_TTL_SECONDS:
                os.remove(path)
        except OSError:
            pass


def public_stamp_payload(item):
    result = dict(item)
    result["url"] = "/files/stamps/%s" % item["storedName"]
    return result


class SealioHandler(BaseHTTPRequestHandler):
    server_version = "SealioBackend/0.1"

    def do_GET(self):
        cleanup_uploads()
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(200, {"ok": True, "service": "sealio-backend"})
            return
        if path == "/api/stamps":
            stamps = read_json_file(STAMP_INDEX, [])
            self.send_json(200, [public_stamp_payload(item) for item in stamps])
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        cleanup_uploads()
        path = urlparse(self.path).path
        if path == "/api/stamps":
            self.handle_file_upload(STAMP_DIR, STAMP_EXTENSIONS, self.save_stamp)
            return
        if path == "/api/uploads":
            self.handle_file_upload(UPLOAD_DIR, DOCUMENT_EXTENSIONS, self.save_temp_upload)
            return
        self.send_json(404, {"error": "Not found"})

    def handle_file_upload(self, target_dir, allowed_extensions, saver):
        content_length = int(self.headers.get("Content-Length") or "0")
        if content_length <= 0:
            self.send_json(400, {"error": "Missing upload body"})
            return
        if content_length > MAX_UPLOAD_BYTES:
            self.send_json(413, {"error": "File is too large"})
            return

        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            self.send_json(415, {"error": "Expected multipart/form-data"})
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(content_length),
            },
        )

        fields = form["file"] if "file" in form else None
        if fields is None:
            self.send_json(400, {"error": "Missing file field"})
            return
        if not isinstance(fields, list):
            fields = [fields]

        saved = []
        for field in fields:
            original_name = os.path.basename(field.filename or "")
            ext = extension_for_name(original_name)
            if ext not in allowed_extensions:
                self.send_json(400, {"error": "Unsupported file type", "file": original_name})
                return
            saved.append(saver(field, target_dir, original_name, ext))

        self.send_json(201, saved)

    def save_stamp(self, field, target_dir, original_name, ext):
        stamp_id = str(uuid.uuid4())
        stored_name = "%s.%s" % (stamp_id, ext)
        stored_path = os.path.join(target_dir, stored_name)
        with open(stored_path, "wb") as output:
            shutil.copyfileobj(field.file, output)

        item = {
            "id": stamp_id,
            "originalName": original_name,
            "storedName": stored_name,
            "mimeType": mime_for_name(original_name),
            "createdAt": int(time.time() * 1000),
            "bytes": os.path.getsize(stored_path),
        }
        stamps = read_json_file(STAMP_INDEX, [])
        stamps.insert(0, item)
        write_json_file(STAMP_INDEX, stamps)
        return public_stamp_payload(item)

    def save_temp_upload(self, field, target_dir, original_name, ext):
        upload_id = str(uuid.uuid4())
        stored_name = "%s.%s" % (upload_id, ext)
        stored_path = os.path.join(target_dir, stored_name)
        with open(stored_path, "wb") as output:
            shutil.copyfileobj(field.file, output)
        created_at = int(time.time() * 1000)
        return {
            "id": upload_id,
            "originalName": original_name,
            "storedName": stored_name,
            "mimeType": mime_for_name(original_name),
            "createdAt": created_at,
            "expiresAt": created_at + UPLOAD_TTL_SECONDS * 1000,
            "bytes": os.path.getsize(stored_path),
            "url": "/files/uploads/%s" % stored_name,
        }

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    ensure_storage()
    host = os.environ.get("SEALIO_HOST", "127.0.0.1")
    port = int(os.environ.get("SEALIO_PORT", "8081"))
    server = ThreadingHTTPServer((host, port), SealioHandler)
    print("Sealio backend listening on %s:%s" % (host, port))
    server.serve_forever()


if __name__ == "__main__":
    main()
