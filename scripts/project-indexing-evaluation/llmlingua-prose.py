"""Opt-in, offline LLMLingua evaluation for supplemental prose only."""

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import time


def file_hash(filename):
    digest = hashlib.sha256()
    with filename.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_local_environment(model_directory, cache_directory, manifest):
    if sys.prefix == sys.base_prefix:
        raise ValueError("Use an isolated virtual environment for this experiment.")
    repository = Path(__file__).resolve().parents[2]
    for directory in (Path(sys.prefix).resolve(), model_directory, cache_directory):
        if directory == repository or repository in directory.parents:
            raise ValueError("Evaluation dependencies, models, and caches belong outside the checkout.")
    for package, expected in manifest["packages"].items():
        if importlib.metadata.version(package) != expected:
            raise ValueError("Unexpected dependency version: " + package)
    for artifact in manifest["model"]["files"]:
        filename = model_directory / artifact["path"]
        if filename.is_symlink() or not filename.is_file():
            raise ValueError("Missing regular model asset: " + artifact["path"])
        if filename.stat().st_size != artifact["bytes"] or file_hash(filename) != artifact["sha256"]:
            raise ValueError("Model asset does not match the pinned revision: " + artifact["path"])
    tokenizer = manifest["tokenizerCache"]
    filename = cache_directory / "tiktoken" / tokenizer["file"]
    if not filename.is_file() or file_hash(filename) != tokenizer["sha256"]:
        raise ValueError("Prepare the pinned tokenizer vocabulary in the isolated cache first.")


def disable_network():
    def refuse_connection(*_args, **_kwargs):
        raise RuntimeError("Offline prose evaluation cannot open network connections; prepare model and tokenizer assets first.")

    socket.create_connection = refuse_connection
    socket.socket.connect = refuse_connection
    socket.socket.connect_ex = refuse_connection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-local-model", action="store_true", required=True)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--cache-dir", required=True, type=Path)
    arguments = parser.parse_args()
    model_directory = arguments.model_dir.resolve(strict=True)
    cache_directory = arguments.cache_dir.resolve(strict=True)
    manifest = json.loads(Path(__file__).with_name("llmlingua-assets.json").read_text())
    require_local_environment(model_directory, cache_directory, manifest)
    raw = sys.stdin.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError("Prose input exceeds the experiment budget.")
    requests = json.loads(raw)
    if not isinstance(requests, list) or len(requests) > 64:
        raise ValueError("Expected at most 64 explicit prose requests.")
    for request in requests:
        if set(request) != {"id", "rate", "text"}:
            raise ValueError("Only an identifier, rate, and supplemental prose may reach this compressor.")
        if not isinstance(request["text"], str) or not 0 < request["rate"] <= 1:
            raise ValueError("Invalid prose text or compression rate.")
    os.environ.update({
        "HF_HOME": str(cache_directory / "huggingface"),
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "TIKTOKEN_CACHE_DIR": str(cache_directory / "tiktoken"),
        "NLTK_DATA": str(cache_directory / "nltk"),
        "TOKENIZERS_PARALLELISM": "false",
    })
    disable_network()
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        from llmlingua import PromptCompressor

        torch.set_num_threads(2)
        torch.set_num_interop_threads(1)
        compressor = PromptCompressor(
            model_name=str(model_directory),
            device_map="cpu",
            use_llmlingua2=True,
            model_config={"trust_remote_code": False, "local_files_only": True, "use_safetensors": True},
            llmlingua2_config={"max_batch_size": 1},
        )
        captures = []
        for request in requests:
            started = time.perf_counter()
            result = compressor.compress_prompt([request["text"]], rate=request["rate"], force_tokens=[])
            captures.append({
                "id": request["id"],
                "rate": request["rate"],
                "sourceSha256": hashlib.sha256(request["text"].encode()).hexdigest(),
                "compressedText": result["compressed_prompt"],
                "durationMs": (time.perf_counter() - started) * 1000,
            })
    print(json.dumps({
        "engine": "LLMLingua-2",
        "softwareVersion": manifest["software"]["version"],
        "model": manifest["model"]["name"],
        "modelRevision": manifest["model"]["revision"],
        "packages": {package: importlib.metadata.version(package) for package in manifest["packages"]},
        "captures": captures,
    }))


if __name__ == "__main__":
    main()
