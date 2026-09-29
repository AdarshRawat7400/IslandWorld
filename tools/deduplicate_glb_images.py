"""Move repeated embedded GLB images into shared, byte-identical files.

Run after Blender or MPFB exports GLBs into public/assets:

    python tools/deduplicate_glb_images.py
    python tools/deduplicate_glb_images.py --verify

This does not encode, resize, or otherwise alter images. Non-image buffer views
are copied byte for byte. The manifest records original and optimized hashes so
the finished source can be verified without retaining duplicate raw GLBs.
The operation is idempotent; already optimized GLBs are only verified.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import struct
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets"
SHARED = ASSETS / "shared_images"
MANIFEST = Path(__file__).with_name("glb_shared_images_manifest.json")
BACKUPS = ROOT.parents[1] / "work" / "glb-image-originals"
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
EXTENSION = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def glb_chunks(blob: bytes) -> tuple[dict, bytes]:
    if len(blob) < 28:
        raise ValueError("GLB is truncated")
    magic, version, length = struct.unpack_from("<4sII", blob)
    if magic != b"glTF" or version != 2 or length != len(blob):
        raise ValueError("Expected a complete glTF 2.0 binary")
    offset = 12
    chunks = []
    while offset < length:
        if offset + 8 > length:
            raise ValueError("Truncated GLB chunk header")
        size, kind = struct.unpack_from("<II", blob, offset)
        offset += 8
        if size % 4 or offset + size > length:
            raise ValueError("Misaligned or truncated GLB chunk")
        chunks.append((kind, blob[offset : offset + size]))
        offset += size
    if len(chunks) != 2 or chunks[0][0] != JSON_CHUNK or chunks[1][0] != BIN_CHUNK:
        raise ValueError("Expected exactly one JSON and one BIN chunk")
    doc = json.loads(chunks[0][1])
    if len(doc.get("buffers", [])) != 1 or "uri" in doc["buffers"][0]:
        raise ValueError("Expected one embedded binary buffer")
    if doc["buffers"][0]["byteLength"] > len(chunks[1][1]):
        raise ValueError("BIN chunk is shorter than declared buffer")
    return doc, chunks[1][1]


def view_bytes(doc: dict, binary: bytes, index: int) -> bytes:
    view = doc["bufferViews"][index]
    if view.get("buffer", 0) != 0:
        raise ValueError("Only buffer zero is supported")
    start = view.get("byteOffset", 0)
    end = start + view["byteLength"]
    if start < 0 or end > doc["buffers"][0]["byteLength"]:
        raise ValueError(f"Buffer view {index} exceeds the declared buffer")
    return binary[start:end]


def visual_json_hash(doc: dict, binary: bytes) -> str:
    """Hash scene/material/texture data that repacking must never change."""
    scene = copy.deepcopy({key: value for key, value in doc.items()
                           if key not in ("buffers", "bufferViews", "images")})

    # Accessor and extension references change numeric index when the image
    # views are removed. Compare their referenced bytes instead of the index.
    def normalize(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "bufferView":
                    value[key] = digest(view_bytes(doc, binary, child))
                else:
                    normalize(child)
        elif isinstance(value, list):
            for item in value:
                normalize(item)

    normalize(scene)
    return digest(json.dumps(scene, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=False).encode("utf-8"))


def serialize_glb(doc: dict, binary: bytes) -> bytes:
    json_blob = json.dumps(doc, separators=(",", ":"),
                           ensure_ascii=False).encode("utf-8")
    json_blob += b" " * (-len(json_blob) % 4)
    binary += b"\0" * (-len(binary) % 4)
    return b"".join((
        struct.pack("<4sII", b"glTF", 2,
                    12 + 8 + len(json_blob) + 8 + len(binary)),
        struct.pack("<II", len(json_blob), JSON_CHUNK), json_blob,
        struct.pack("<II", len(binary), BIN_CHUNK), binary,
    ))


def externalize(name: str, source: bytes) -> tuple[bytes, dict, dict[str, bytes]]:
    original_doc, original_bin = glb_chunks(source)
    doc = copy.deepcopy(original_doc)
    images = doc.get("images", [])
    if not images or not all("bufferView" in image for image in images):
        raise ValueError(f"{name}: expected only embedded source images")

    image_views: set[int] = set()
    external: dict[str, bytes] = {}
    image_records = []
    for image in images:
        old_index = image.pop("bufferView")
        mime = image.pop("mimeType", None)
        extension = EXTENSION.get(mime)
        if extension is None or "uri" in image:
            raise ValueError(f"{name}: unsupported embedded image format")
        raw = view_bytes(original_doc, original_bin, old_index)
        image_hash = digest(raw)
        filename = f"{image_hash}.{extension}"
        image["uri"] = f"shared_images/{filename}"
        image_views.add(old_index)
        external[filename] = raw
        image_records.append({"sha256": image_hash, "bytes": len(raw),
                              "mimeType": mime, "uri": image["uri"]})

    # Keep every non-image view in its original order. Remap references in
    # accessors and any extension objects, rejecting any shared image view.
    remap: dict[int, int] = {}
    new_views = []
    rebuilt = bytearray()
    geometry_records = []
    for old_index, view in enumerate(original_doc["bufferViews"]):
        if old_index in image_views:
            continue
        payload = view_bytes(original_doc, original_bin, old_index)
        rebuilt.extend(b"\0" * (-len(rebuilt) % 4))
        replacement = copy.deepcopy(view)
        replacement["byteOffset"] = len(rebuilt)
        remap[old_index] = len(new_views)
        new_views.append(replacement)
        rebuilt.extend(payload)
        geometry_records.append({"sha256": digest(payload),
                                 "bytes": len(payload)})

    def remap_references(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "bufferView":
                    if not isinstance(child, int) or child not in remap:
                        raise ValueError(f"{name}: an embedded image view is used elsewhere")
                    value[key] = remap[child]
                else:
                    remap_references(child)
        elif isinstance(value, list):
            for item in value:
                remap_references(item)

    remap_references(doc)
    doc["bufferViews"] = new_views
    doc["buffers"][0]["byteLength"] = len(rebuilt)
    output = serialize_glb(doc, bytes(rebuilt))
    parsed, output_bin = glb_chunks(output)
    if visual_json_hash(parsed, output_bin) != visual_json_hash(original_doc, original_bin):
        raise ValueError(f"{name}: scene or material data changed")
    if [digest(view_bytes(parsed, output_bin, i)) for i in range(len(new_views))] != [
            record["sha256"] for record in geometry_records]:
        raise ValueError(f"{name}: non-image buffer data changed")

    record = {"sourceSha256": digest(source), "optimizedSha256": digest(output),
              "sourceBytes": len(source), "optimizedBytes": len(output),
              "visualJsonSha256": visual_json_hash(original_doc, original_bin),
              "images": image_records, "bufferViews": geometry_records}
    return output, record, external


def verify_model(path: Path, record: dict) -> None:
    blob = path.read_bytes()
    if digest(blob) != record["optimizedSha256"] or len(blob) != record["optimizedBytes"]:
        raise ValueError(f"{path.name}: optimized GLB hash or size changed")
    doc, binary = glb_chunks(blob)
    if visual_json_hash(doc, binary) != record["visualJsonSha256"]:
        raise ValueError(f"{path.name}: scene or material metadata changed")
    if len(doc.get("images", [])) != len(record["images"]):
        raise ValueError(f"{path.name}: image count changed")
    for image, expected in zip(doc["images"], record["images"]):
        if image.get("uri") != expected["uri"] or "bufferView" in image:
            raise ValueError(f"{path.name}: image URI changed")
        uri = image["uri"]
        if uri != f"shared_images/{expected['sha256']}.{EXTENSION[expected['mimeType']]}":
            raise ValueError(f"{path.name}: unexpected shared image path")
        shared = ASSETS / uri
        raw = shared.read_bytes()
        if digest(raw) != expected["sha256"] or len(raw) != expected["bytes"]:
            raise ValueError(f"{path.name}: shared image bytes changed: {shared.name}")
    if len(doc["bufferViews"]) != len(record["bufferViews"]):
        raise ValueError(f"{path.name}: non-image view count changed")
    for index, expected in enumerate(record["bufferViews"]):
        raw = view_bytes(doc, binary, index)
        if digest(raw) != expected["sha256"] or len(raw) != expected["bytes"]:
            raise ValueError(f"{path.name}: buffer view {index} changed")


def atomic_write(path: Path, blob: bytes, allow_in_place: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as staged:
        staged.write(blob)
        temporary = Path(staged.name)
    try:
        os.replace(temporary, path)
    except PermissionError:
        if not allow_in_place or not path.exists():
            raise
        # Windows can permit writing a file while denying its replacement by
        # rename. The original is already backed up outside the public tree.
        with path.open("r+b") as target:
            target.write(blob)
            target.truncate()
            target.flush()
            os.fsync(target.fileno())
        temporary.unlink()


def run(verify_only: bool) -> dict:
    paths = sorted(ASSETS.glob("*.glb"))
    if not paths:
        raise ValueError("No GLBs found in public/assets")
    existing = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    records = {}
    outputs = {}
    shared_payloads: dict[str, bytes] = {}
    for path in paths:
        blob = path.read_bytes()
        doc, _ = glb_chunks(blob)
        embedded = any("bufferView" in image for image in doc.get("images", []))
        if embedded:
            if verify_only:
                raise ValueError(f"{path.name}: images are still embedded")
            output, record, payloads = externalize(path.name, blob)
            outputs[path] = output
            records[path.name] = record
            for filename, payload in payloads.items():
                if filename in shared_payloads and shared_payloads[filename] != payload:
                    raise ValueError(f"SHA-256 collision for {filename}")
                shared_payloads[filename] = payload
        else:
            record = existing.get(path.name)
            if record is None:
                raise ValueError(f"{path.name}: optimized asset has no verification record")
            verify_model(path, record)
            records[path.name] = record
    if verify_only:
        if set(existing) != set(records):
            raise ValueError("Manifest asset set differs from public GLBs")
    else:
        SHARED.mkdir(parents=True, exist_ok=True)
        for filename, payload in shared_payloads.items():
            destination = SHARED / filename
            if destination.exists():
                if digest(destination.read_bytes()) != digest(payload):
                    raise ValueError(f"Existing shared image differs: {filename}")
            else:
                atomic_write(destination, payload)
        # Publish the manifest first so an interrupted run can be resumed by
        # processing raw models and checking already optimized ones.
        atomic_write(MANIFEST, (json.dumps(records, indent=2, sort_keys=True)
                                + "\n").encode("utf-8"))
        for path, output in outputs.items():
            source = path.read_bytes()
            original_backup = BACKUPS / f"{path.stem}.{digest(source)}.glb"
            if not original_backup.exists():
                atomic_write(original_backup, source)
            atomic_write(path, output, allow_in_place=True)
    for path in paths:
        verify_model(path, records[path.name])
    source_bytes = sum(record["sourceBytes"] for record in records.values())
    optimized_bytes = sum(record["optimizedBytes"] for record in records.values())
    referenced = {image["uri"] for record in records.values()
                  for image in record["images"]}
    external_bytes = sum((ASSETS / uri).stat().st_size for uri in referenced)
    return {"models": len(records), "distinctImages": len(referenced),
            "sourceBytes": source_bytes,
            "optimizedModelsBytes": optimized_bytes,
            "sharedImagesBytes": external_bytes,
            "combinedBytes": optimized_bytes + external_bytes,
            "bytesSaved": source_bytes - optimized_bytes - external_bytes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Check optimized GLBs and manifest")
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.verify), indent=2))
