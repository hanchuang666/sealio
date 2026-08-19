#!/usr/bin/env python3
import cgi
import json
import mimetypes
import os
import shutil
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import unquote, urlparse


PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.environ.get("SEALIO_DATA_DIR", os.path.join(PROJECT_DIR, ".sealio-data"))
STAMP_DIR = os.path.join(DATA_DIR, "stamps")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
STAMP_INDEX = os.path.join(DATA_DIR, "stamps.json")
MAX_UPLOAD_BYTES = int(os.environ.get("SEALIO_MAX_UPLOAD_BYTES", str(80 * 1024 * 1024)))
UPLOAD_TTL_SECONDS = int(os.environ.get("SEALIO_UPLOAD_TTL_SECONDS", str(24 * 60 * 60)))
UPLOAD_CLEANUP_INTERVAL_SECONDS = int(os.environ.get("SEALIO_UPLOAD_CLEANUP_INTERVAL_SECONDS", "60"))

STAMP_EXTENSIONS = {"png", "jpg", "jpeg"}
DOCUMENT_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}
STAMP_INDEX_LOCK = threading.Lock()
UPLOAD_CLEANUP_LOCK = threading.Lock()
last_upload_cleanup_at = 0.0


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def ensure_storage():
    for path in [DATA_DIR, STAMP_DIR, UPLOAD_DIR]:
        os.makedirs(path, exist_ok=True)
    with STAMP_INDEX_LOCK:
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


def cleanup_uploads(force=False):
    global last_upload_cleanup_at
    monotonic_now = time.monotonic()
    if not force and monotonic_now - last_upload_cleanup_at < UPLOAD_CLEANUP_INTERVAL_SECONDS:
        return
    if not UPLOAD_CLEANUP_LOCK.acquire(blocking=False):
        return
    try:
        monotonic_now = time.monotonic()
        if not force and monotonic_now - last_upload_cleanup_at < UPLOAD_CLEANUP_INTERVAL_SECONDS:
            return
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
        last_upload_cleanup_at = monotonic_now
    finally:
        UPLOAD_CLEANUP_LOCK.release()


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
            with STAMP_INDEX_LOCK:
                stamps = read_json_file(STAMP_INDEX, [])
            self.send_json(200, [public_stamp_payload(item) for item in stamps])
            return
        if self.send_storage_file(path, "/files/stamps/", STAMP_DIR, "private, max-age=3600"):
            return
        if self.send_storage_file(path, "/files/uploads/", UPLOAD_DIR, "no-store"):
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
        try:
            content_length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length"})
            return
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

        uploads = []
        for field in fields:
            original_name = os.path.basename(field.filename or "")
            ext = extension_for_name(original_name)
            if ext not in allowed_extensions:
                self.send_json(400, {"error": "Unsupported file type", "file": original_name})
                return
            uploads.append((field, original_name, ext))

        saved = [saver(field, target_dir, original_name, ext) for field, original_name, ext in uploads]
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
        with STAMP_INDEX_LOCK:
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

    def send_storage_file(self, request_path, prefix, directory, cache_control):
        if not request_path.startswith(prefix):
            return False

        stored_name = unquote(request_path[len(prefix) :])
        if not stored_name or stored_name != os.path.basename(stored_name):
            self.send_json(404, {"error": "Not found"})
            return True

        file_path = os.path.join(directory, stored_name)
        if not os.path.isfile(file_path):
            self.send_json(404, {"error": "Not found"})
            return True

        file_size = os.path.getsize(file_path)
        self.send_response(200)
        self.send_header("Content-Type", mime_for_name(stored_name))
        self.send_header("Content-Length", str(file_size))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        with open(file_path, "rb") as source:
            shutil.copyfileobj(source, self.wfile)
        return True

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    ensure_storage()
    cleanup_uploads(force=True)
    host = os.environ.get("SEALIO_HOST", "127.0.0.1")
    port = int(os.environ.get("SEALIO_PORT", "8081"))
    server = ThreadingHTTPServer((host, port), SealioHandler)
    print("Sealio backend listening on %s:%s" % (host, port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
