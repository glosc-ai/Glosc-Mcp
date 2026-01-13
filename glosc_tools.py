from __future__ import annotations

import base64
import csv
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from markitdown import MarkItDown


MatchMode = Literal["contains", "equals", "regex"]


@dataclass(frozen=True)
class SpawnResult:
    code: int
    output: str


class GloscTools:
    @staticmethod
    def iso_utc_now() -> str:
        return (
            datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )

    @staticmethod
    def escape_powershell_single_quoted(value: str) -> str:
        return "'" + value.replace("'", "''") + "'"

    @staticmethod
    def extract_json_from_output(output: str) -> str | None:
        trimmed = output.strip()
        if not trimmed:
            return None

        first_brace = trimmed.find("{")
        first_bracket = trimmed.find("[")
        starts = [n for n in (first_brace, first_bracket) if n >= 0]
        if not starts:
            return None
        start = min(starts)

        last_brace = trimmed.rfind("}")
        last_bracket = trimmed.rfind("]")
        ends = [n for n in (last_brace, last_bracket) if n >= 0]
        if not ends:
            return None
        end = max(ends)

        if end <= start:
            return None
        return trimmed[start : end + 1]

    @staticmethod
    def spawn_command(
        command: str, args: list[str], *, encoding: str = "utf-8"
    ) -> SpawnResult:
        proc = subprocess.run(
            [command, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        output = proc.stdout.decode(encoding, errors="replace")
        if proc.returncode != 0:
            raise RuntimeError(
                f"Process exited with code {proc.returncode}: {command} {' '.join(args)}\n{output}"
            )
        return SpawnResult(code=proc.returncode, output=output)

    @staticmethod
    def match_score(name: str, query: str) -> int:
        n = name.lower()
        q = query.lower()
        if n == q:
            return 0
        if n.startswith(q):
            return 1
        if q in n:
            return 2
        return 3

    @staticmethod
    def filter_apps(apps: list[dict[str, Any]], query: str, match_mode: MatchMode) -> list[dict[str, Any]]:
        q = query.strip()
        if not q:
            return apps

        if match_mode == "regex":
            try:
                pattern = re.compile(q, re.IGNORECASE)
            except re.error:
                return []
            return [a for a in apps if pattern.search(str(a.get("name", "")))]

        nq = q.lower()
        matches: list[dict[str, Any]] = []
        for app in apps:
            name = str(app.get("name", ""))
            n = name.lower()
            if match_mode == "equals":
                if n == nq:
                    matches.append(app)
            else:
                if nq in n:
                    matches.append(app)

        return sorted(matches, key=lambda a: GloscTools.match_score(str(a.get("name", "")), q))

    @staticmethod
    def list_installed_apps(options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if os.name != "nt":
            raise RuntimeError("当前仅支持 Windows：通过注册表获取已安装应用列表")

        options = options or {}
        query = (options.get("query") or "").strip() or None
        match_mode: MatchMode = options.get("matchMode") or "contains"
        limit = int(options.get("limit") or 200)

        ps_script = r"""
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

$apps = foreach ($p in $paths) {
  Get-ItemProperty -Path $p | Where-Object { $_.DisplayName -and $_.DisplayName.Trim().Length -gt 0 } | ForEach-Object {
    [PSCustomObject]@{
      Name = $_.DisplayName
      Version = $_.DisplayVersion
      Publisher = $_.Publisher
      InstallLocation = $_.InstallLocation
      InstallSource = $_.InstallSource
      DisplayIcon = $_.DisplayIcon
      UninstallString = $_.UninstallString
      QuietUninstallString = $_.QuietUninstallString
      RegistryKey = $_.PSPath
    }
  }
}

$apps = $apps | Sort-Object Name, Version, Publisher -Unique

if ($null -ne $apps) {
  $apps | ConvertTo-Json -Depth 4
}
"""

        res = GloscTools.spawn_command(
            "powershell",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
            encoding="utf-8",
        )

        json_text = GloscTools.extract_json_from_output(res.output) or "[]"
        try:
            parsed = json.loads(json_text)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"解析应用列表失败: {e}")

        apps_raw = parsed if isinstance(parsed, list) else [parsed]

        normalized: list[dict[str, Any]] = []
        for a in apps_raw:
            if not isinstance(a, dict):
                continue
            name = a.get("Name")
            if not isinstance(name, str) or not name.strip():
                continue
            normalized.append(
                {
                    "name": str(name),
                    "version": str(a.get("Version")) if a.get("Version") else None,
                    "publisher": str(a.get("Publisher")) if a.get("Publisher") else None,
                    "installLocation": str(a.get("InstallLocation")) if a.get("InstallLocation") else None,
                    "installSource": str(a.get("InstallSource")) if a.get("InstallSource") else None,
                    "displayIcon": str(a.get("DisplayIcon")) if a.get("DisplayIcon") else None,
                    "uninstallString": str(a.get("UninstallString")) if a.get("UninstallString") else None,
                    "quietUninstallString": str(a.get("QuietUninstallString"))
                    if a.get("QuietUninstallString")
                    else None,
                    "registryKey": str(a.get("RegistryKey")) if a.get("RegistryKey") else None,
                }
            )

        normalized.sort(key=lambda x: str(x.get("name", "")).lower())
        filtered = GloscTools.filter_apps(normalized, query, match_mode) if query else normalized
        return filtered[: max(1, limit)]

    @staticmethod
    def _extract_path_from_command_like(value: str | None) -> str | None:
        if not value:
            return None
        v = value.strip()
        if not v:
            return None

        comma_index = v.find(",")
        if comma_index > 0:
            v = v[:comma_index]

        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]

        m = re.match(r'^"([^"]+)"', v)
        if m and m.group(1):
            return m.group(1)

        first_token = re.split(r"\s+", v, maxsplit=1)[0]
        return first_token or None

    @staticmethod
    def infer_install_path_from_app(app: dict[str, Any]) -> dict[str, Any]:
        loc = (app.get("installLocation") or "").strip()
        if loc:
            return {"installPath": loc, "source": "InstallLocation", "raw": loc}

        from_display_icon = GloscTools._extract_path_from_command_like(app.get("displayIcon"))
        if from_display_icon:
            return {
                "installPath": str(Path(from_display_icon).parent),
                "source": "DisplayIcon",
                "raw": app.get("displayIcon"),
            }

        from_uninstall = GloscTools._extract_path_from_command_like(
            app.get("quietUninstallString") or app.get("uninstallString")
        )
        if from_uninstall:
            return {
                "installPath": str(Path(from_uninstall).parent),
                "source": "UninstallString",
                "raw": app.get("quietUninstallString") or app.get("uninstallString"),
            }

        return {}

    @staticmethod
    def get_app_install_path(options: dict[str, Any]) -> dict[str, Any]:
        query = str(options.get("name") or "").strip()
        if not query:
            raise RuntimeError("name 不能为空")

        match_mode: MatchMode = options.get("matchMode") or "contains"
        all_matches = bool(options.get("allMatches") or False)
        limit = int(options.get("limit") or 50)

        apps = GloscTools.list_installed_apps({"query": query, "matchMode": match_mode, "limit": limit})

        candidates: list[dict[str, Any]] = []
        for a in apps:
            inferred = GloscTools.infer_install_path_from_app(a)
            candidates.append(
                {
                    "name": a.get("name"),
                    "version": a.get("version"),
                    "publisher": a.get("publisher"),
                    "installLocation": a.get("installLocation"),
                    "inferredInstallPath": inferred.get("installPath"),
                    "inferredSource": inferred.get("source"),
                }
            )

        best = candidates[0] if candidates else None
        return {
            "query": query,
            "matchMode": match_mode,
            "result": (
                {
                    "name": best.get("name"),
                    "installPath": best.get("installLocation") or best.get("inferredInstallPath"),
                    "source": "InstallLocation" if best.get("installLocation") else best.get("inferredSource"),
                    "version": best.get("version"),
                    "publisher": best.get("publisher"),
                }
                if (best and not all_matches)
                else None
            ),
            "candidates": candidates if all_matches else candidates[:10],
        }

    @staticmethod
    def open_reference(options: dict[str, Any]) -> dict[str, Any]:
        target = str(options.get("target") or "").strip()
        if not target:
            raise RuntimeError("target 不能为空")

        args = options.get("args") or []
        wait = bool(options.get("wait") or False)

        if os.name == "nt":
            file_path = GloscTools.escape_powershell_single_quoted(target)
            arg_list = ""
            if args:
                arg_list = " -ArgumentList @(" + ", ".join(
                    GloscTools.escape_powershell_single_quoted(str(a)) for a in args
                ) + ")"
            wait_flag = " -Wait" if wait else ""
            script = f"Start-Process -FilePath {file_path}{arg_list}{wait_flag}"

            GloscTools.spawn_command(
                "powershell",
                ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                encoding="utf-8",
            )
            return {"ok": True, "target": target}

        if sys.platform == "darwin":
            GloscTools.spawn_command("open", [target], encoding="utf-8")
            return {"ok": True, "target": target}

        GloscTools.spawn_command("xdg-open", [target], encoding="utf-8")
        return {"ok": True, "target": target}

    @staticmethod
    async def usebrowser(
        url: str,
        use_browser: bool = False,
        content_type: Literal["text", "html", "json"] = "text",
    ) -> str:
        import httpx

        try:
            if use_browser:
                try:
                    from playwright.async_api import async_playwright  # type: ignore
                except Exception:
                    return "获取网页内容失败: useBrowser=true 需要安装 playwright"

                async with async_playwright() as p:
                    browser = await p.chromium.launch()
                    page = await browser.new_page()
                    await page.goto(url, wait_until="networkidle")
                    html = await page.content()
                    await browser.close()

                if content_type == "html":
                    return html

                text = GloscTools._html_to_text(html)
                if content_type == "text":
                    return text

                try:
                    parsed = json.loads(text)
                    return json.dumps(parsed, ensure_ascii=False, indent=2)
                except Exception:
                    return text

            async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
                resp = await client.get(url)
                resp.raise_for_status()

                if content_type == "json":
                    try:
                        parsed = resp.json()
                        return json.dumps(parsed, ensure_ascii=False, indent=2)
                    except Exception:
                        return resp.text

                return resp.text

        except Exception as e:
            return f"获取网页内容失败: {e}"

    @staticmethod
    def _html_to_text(html: str) -> str:
        try:
            from bs4 import BeautifulSoup  # type: ignore

            soup = BeautifulSoup(html, "html.parser")
            return soup.get_text(" ", strip=True)
        except Exception:
            # 简易兜底：去标签 + 压缩空白
            text = re.sub(r"<[^>]+>", " ", html)
            return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def parse_7z_output(output: str) -> list[dict[str, Any]]:
        lines = output.splitlines()
        file_list: list[dict[str, Any]] = []
        in_file_list = False

        for line in lines:
            if "Date" in line and "Time" in line and "Attr" in line:
                in_file_list = True
                continue

            if in_file_list and line.strip() and ("---" not in line) and ("files" not in line):
                parts = re.split(r"\s+", line.strip())
                if len(parts) >= 6:
                    attr = parts[2]
                    try:
                        size = int(parts[3])
                    except Exception:
                        size = 0
                    name = " ".join(parts[5:])
                    is_dir = ("D" in attr) or ("d" in attr)
                    file_list.append({"name": name, "size": size, "isDirectory": is_dir})

        return file_list

    @staticmethod
    def _detect_compound_ext(file_path: Path) -> str:
        lower = file_path.name.lower()
        for ext in [".tar.gz", ".tar.bz2"]:
            if lower.endswith(ext):
                return ext
        return file_path.suffix.lower()

    @staticmethod
    def process_file(file_path: str) -> str:
        p = Path(file_path)
        ext = GloscTools._detect_compound_ext(p)

        data = p.read_bytes()

        if ext in {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}:
            b64 = base64.b64encode(data).decode("ascii")
            mime, _ = mimetypes.guess_type(str(p))
            if not mime:
                mime = f"image/{ext.lstrip('.')}"
            return f"data:{mime};base64,{b64}"

        if ext in {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tar.gz", ".tar.bz2"}:
            seven_zip = (Path(__file__).resolve().parent / "libs" / "7z" / "win" / "7za.exe")
            if not seven_zip.exists():
                return "7z 工具不存在: libs/7z/win/7za.exe"

            res = GloscTools.spawn_command(str(seven_zip), ["l", str(p)], encoding="gbk")
            file_list = GloscTools.parse_7z_output(res.output)
            return json.dumps(file_list, ensure_ascii=False)

        # MarkItDown 优先：除图片/压缩包外，先尝试让 MarkItDown 做转换。
        # 若 MarkItDown 无法处理或返回空内容，再回退到原有解析逻辑。
        try:
            md_text = GloscTools._markitdown_convert(p)
            if md_text and md_text.strip():
                return md_text
        except Exception:
            pass

        if ext == ".csv":
            text = GloscTools._decode_text_bytes(data)
            reader = csv.DictReader(text.splitlines())
            rows = list(reader)
            return json.dumps(rows, ensure_ascii=False, indent=2)

        if ext in {".xlsx", ".xls"}:
            as_json = GloscTools._try_read_excel_to_json(p)
            if as_json is not None:
                return as_json
            # Excel 解析失败时，再尝试 MarkItDown（可能依赖可选组件）
            try:
                return GloscTools._markitdown_convert(p)
            except Exception:
                pass

        if ext in {
            ".txt",
            ".md",
            ".json",
            ".js",
            ".ts",
            ".html",
            ".css",
            ".xml",
            ".yaml",
            ".yml",
        }:
            return GloscTools._decode_text_bytes(data)

        return GloscTools._decode_text_bytes(data)

    @staticmethod
    def _decode_text_bytes(data: bytes) -> str:
        for enc in ("utf-8", "utf-8-sig", "gbk", "cp1252"):
            try:
                return data.decode(enc)
            except Exception:
                continue
        return data.decode("utf-8", errors="replace")

    @staticmethod
    def _markitdown_convert(source: Path) -> str:
        md = MarkItDown()
        result = md.convert(source)
        return result.text_content

    @staticmethod
    def _try_read_excel_to_json(source: Path) -> str | None:
        if source.suffix.lower() == ".xlsx":
            try:
                import openpyxl  # type: ignore

                wb = openpyxl.load_workbook(source, data_only=True)
                sheet_names = [s for s in wb.sheetnames if isinstance(s, str) and s.strip()]
                if not sheet_names:
                    return json.dumps([], ensure_ascii=False, indent=2)

                sheets: list[dict[str, Any]] = []
                for name in sheet_names:
                    ws = wb[name]
                    rows = list(ws.iter_rows(values_only=True))
                    if not rows:
                        sheets.append({"sheetName": name, "rows": []})
                        continue

                    header = [str(c).strip() if c is not None else "" for c in rows[0]]
                    normalized_header = [h if h else f"col_{i+1}" for i, h in enumerate(header)]

                    out_rows: list[dict[str, Any]] = []
                    for r in rows[1:]:
                        obj: dict[str, Any] = {}
                        for i, key in enumerate(normalized_header):
                            obj[key] = r[i] if i < len(r) else None
                        out_rows.append(obj)

                    sheets.append({"sheetName": name, "rows": out_rows})

                if len(sheets) == 1:
                    return json.dumps(sheets[0]["rows"], ensure_ascii=False, indent=2)
                return json.dumps({"sheets": sheets}, ensure_ascii=False, indent=2)

            except Exception:
                return None

        if source.suffix.lower() == ".xls":
            try:
                import xlrd  # type: ignore

                book = xlrd.open_workbook(str(source))
                sheet_names = [s for s in book.sheet_names() if isinstance(s, str) and s.strip()]
                if not sheet_names:
                    return json.dumps([], ensure_ascii=False, indent=2)

                sheets: list[dict[str, Any]] = []
                for name in sheet_names:
                    sh = book.sheet_by_name(name)
                    if sh.nrows == 0:
                        sheets.append({"sheetName": name, "rows": []})
                        continue

                    header = [str(sh.cell_value(0, c)).strip() for c in range(sh.ncols)]
                    normalized_header = [h if h else f"col_{i+1}" for i, h in enumerate(header)]

                    out_rows: list[dict[str, Any]] = []
                    for r in range(1, sh.nrows):
                        obj: dict[str, Any] = {}
                        for c, key in enumerate(normalized_header):
                            v = sh.cell_value(r, c)
                            obj[key] = v
                        out_rows.append(obj)
                    sheets.append({"sheetName": name, "rows": out_rows})

                if len(sheets) == 1:
                    return json.dumps(sheets[0]["rows"], ensure_ascii=False, indent=2)
                return json.dumps({"sheets": sheets}, ensure_ascii=False, indent=2)
            except Exception:
                return None

        return None

    @staticmethod
    def _path_exists(p: Path) -> bool:
        try:
            p.lstat()
            return True
        except FileNotFoundError:
            return False

    @staticmethod
    def _remove_path(target: Path) -> None:
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        else:
            try:
                target.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _move_path_internal(options: dict[str, Any]) -> dict[str, Any]:
        from_path = str(options.get("from") or "").strip()
        to_path = str(options.get("to") or "").strip()
        if not from_path:
            raise RuntimeError("from 不能为空")
        if not to_path:
            raise RuntimeError("to 不能为空")

        overwrite = bool(options.get("overwrite") or False)
        create_dirs = bool(options.get("createDirs") if options.get("createDirs") is not None else True)

        src = Path(from_path)
        if not src.exists():
            raise RuntimeError("源路径不存在")

        dest = Path(to_path)
        to_looks_like_dir = bool(re.search(r"[\\/]+$", to_path))
        if to_looks_like_dir:
            dest = dest / src.name
        else:
            if dest.exists() and dest.is_dir():
                dest = dest / src.name

        if dest.exists() or dest.is_symlink():
            if not overwrite:
                raise RuntimeError("目标已存在；如需覆盖请设置 overwrite=true")
            GloscTools._remove_path(dest)

        if create_dirs:
            dest.parent.mkdir(parents=True, exist_ok=True)

        try:
            src.rename(dest)
            return {"ok": True, "from": str(src), "to": str(dest)}
        except OSError as e:
            # EXDEV / cross-device
            if getattr(e, "winerror", None) in (17,) or getattr(e, "errno", None) == getattr(os, "EXDEV", 18):
                if src.is_dir():
                    shutil.copytree(src, dest, dirs_exist_ok=False)
                    shutil.rmtree(src)
                else:
                    shutil.copy2(src, dest)
                    src.unlink()
                return {"ok": True, "from": str(src), "to": str(dest)}
            raise

    @staticmethod
    def rename_file(options: dict[str, Any]) -> dict[str, Any]:
        src_path = str(options.get("path") or "").strip()
        new_name = str(options.get("newName") or "").strip()
        overwrite = bool(options.get("overwrite") or False)

        if not src_path:
            raise RuntimeError("path 不能为空")
        if not new_name:
            raise RuntimeError("newName 不能为空")

        base = Path(new_name).name
        if base != new_name:
            raise RuntimeError("newName 只能是文件名，不能包含路径分隔符")

        src = Path(src_path)
        dest = src.parent / new_name
        return GloscTools._move_path_internal(
            {"from": str(src), "to": str(dest), "overwrite": overwrite, "createDirs": True}
        )

    @staticmethod
    def move_file(options: dict[str, Any]) -> dict[str, Any]:
        return GloscTools._move_path_internal(options)

    @staticmethod
    def list_files_recursive(options: dict[str, Any]) -> dict[str, Any]:
        dir_path = str(options.get("dir") or "").strip()
        if not dir_path:
            raise RuntimeError("dir 不能为空")

        limit = int(options.get("limit") or 5000)
        limit = max(1, limit)

        root = Path(dir_path)
        if not root.exists():
            raise RuntimeError("目录不存在")
        if not root.is_dir():
            raise RuntimeError("dir 必须是目录")

        files: list[str] = []
        truncated = False

        for current_root, _, filenames in os.walk(root):
            for name in filenames:
                files.append(str(Path(current_root) / name))
                if len(files) >= limit:
                    truncated = True
                    break
            if truncated:
                break

        return {"ok": True, "dir": dir_path, "files": files, "truncated": truncated}
