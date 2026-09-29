"""Repack an embedded-image GLB with pixel-exact, lossless WebP textures.

Requires Three.js GLTFLoader's EXT_texture_webp support at runtime. The source
is never overwritten; run with --out to write a candidate after validation.
"""

from __future__ import annotations

import argparse
import io
import json
import struct
from pathlib import Path

from PIL import Image

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
WEBP_EXTENSION = "EXT_texture_webp"


def chunks_from_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Expected a complete glTF 2.0 binary")
    offset = 12
    chunks = []
    while offset < length:
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks.append((kind, data[offset : offset + size]))
        offset += size
    if len(chunks) != 2 or chunks[0][0] != JSON_CHUNK or chunks[1][0] != BIN_CHUNK:
        raise ValueError("Expected one JSON and one BIN chunk")
    return json.loads(chunks[0][1]), chunks[1][1]


def png_to_exact_webp(png: bytes) -> bytes:
    with Image.open(io.BytesIO(png)) as image:
        original = image.convert("RGBA")
        output = io.BytesIO()
        image.save(output, format="WEBP", lossless=True, exact=True, method=6)
        webp = output.getvalue()
    with Image.open(io.BytesIO(webp)) as decoded:
        if decoded.convert("RGBA").tobytes() != original.tobytes():
            raise ValueError("Lossless WebP did not preserve all RGBA pixels")
    return webp


def pack(glb: Path, destination: Path | None) -> dict:
    source = glb.read_bytes()
    document, binary = chunks_from_glb(source)
    if len(document.get("buffers", [])) != 1:
        raise ValueError("Only one-buffer GLBs are supported")
    views = document["bufferViews"]
    replacements: dict[int, bytes] = {}
    original_image_bytes = 0
    new_image_bytes = 0
    for image in document.get("images", []):
        if image.get("mimeType") != "image/png" or "bufferView" not in image:
            raise ValueError("All source images must be embedded PNGs")
        index = image["bufferView"]
        view = views[index]
        start = view.get("byteOffset", 0)
        png = binary[start : start + view["byteLength"]]
        webp = png_to_exact_webp(png)
        if index in replacements:
            raise ValueError("Two images share one buffer view")
        replacements[index] = webp
        original_image_bytes += len(png)
        new_image_bytes += len(webp)
        image["mimeType"] = "image/webp"

    for texture in document.get("textures", []):
        image_index = texture.pop("source")
        texture.setdefault("extensions", {})[WEBP_EXTENSION] = {"source": image_index}
    document.setdefault("extensionsUsed", []).append(WEBP_EXTENSION)
    document.setdefault("extensionsRequired", []).append(WEBP_EXTENSION)

    rebuilt = bytearray()
    for index, view in enumerate(views):
        start = view.get("byteOffset", 0)
        payload = replacements.get(index, binary[start : start + view["byteLength"]])
        rebuilt.extend(b"\x00" * (-len(rebuilt) % 4))
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(payload)
        rebuilt.extend(payload)
    document["buffers"][0]["byteLength"] = len(rebuilt)
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    rebuilt.extend(b"\x00" * (-len(rebuilt) % 4))
    output = b"".join((
        struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(json_bytes) + 8 + len(rebuilt)),
        struct.pack("<II", len(json_bytes), JSON_CHUNK), json_bytes,
        struct.pack("<II", len(rebuilt), BIN_CHUNK), rebuilt,
    ))
    parsed, parsed_binary = chunks_from_glb(output)
    if parsed["buffers"][0]["byteLength"] > len(parsed_binary):
        raise ValueError("Repacked binary is shorter than its declared buffer")
    if destination:
        destination.write_bytes(output)
    return {
        "source": str(glb),
        "destination": str(destination) if destination else None,
        "images": len(replacements),
        "originalImageMB": round(original_image_bytes / 1048576, 2),
        "webpImageMB": round(new_image_bytes / 1048576, 2),
        "sourceMB": round(len(source) / 1048576, 2),
        "outputMB": round(len(output) / 1048576, 2),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    print(json.dumps(pack(args.source, args.out), indent=2))
