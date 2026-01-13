from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import Field

from mcp.server.fastmcp import FastMCP

from glosc_tools import GloscTools


mcp = FastMCP("gloss-mod-manager")


@mcp.tool(name="time", description="获取当前时间")
async def tool_time() -> str:
    return GloscTools.iso_utc_now()


@mcp.tool(name="web", description="提取网页内容")
async def tool_web(
    url: str,
    useBrowser: bool = False,
    type: Literal["text", "html", "json"] = "text",
) -> str:
    return await GloscTools.usebrowser(url, useBrowser, type)


@mcp.tool(
    name="readFile",
    description="读取文件内容，支持多种文件类型：文本、图片、表格、文档、压缩包（ZIP、RAR、7Z、TAR、GZ等）",
)
async def tool_read_file(path: str) -> str:
    try:
        return GloscTools.process_file(path)
    except Exception as e:
        return f"读取文件失败: {e}"


@mcp.tool(name="listApps", description="获取已安装应用列表（Windows 注册表）")
async def tool_list_apps(
    query: str | None = None,
    matchMode: Literal["contains", "equals", "regex"] = "contains",
    limit: int = 200,
) -> str:
    apps = GloscTools.list_installed_apps(
        {"query": query, "matchMode": matchMode, "limit": limit}
    )
    return json.dumps(apps, ensure_ascii=False, indent=2)


@mcp.tool(
    name="getAppInstallPath",
    description="获取应用安装路径（优先 InstallLocation，其次推断）",
)
async def tool_get_app_install_path(
    name: str,
    matchMode: Literal["contains", "equals", "regex"] = "contains",
    allMatches: bool = False,
    limit: int = 50,
) -> str:
    result = GloscTools.get_app_install_path(
        {
            "name": name,
            "matchMode": matchMode,
            "allMatches": allMatches,
            "limit": limit,
        }
    )
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool(
    name="openRef",
    description="打开引用（文件/文件夹/URL/可执行文件），使用系统默认方式打开",
)
async def tool_open_ref(
    target: str,
    args: list[str] | None = None,
    wait: bool = False,
) -> str:
    res = GloscTools.open_reference({"target": target, "args": args or [], "wait": wait})
    return json.dumps(res, ensure_ascii=False, indent=2)


@mcp.tool(name="renameFile", description="重命名文件（同目录改名）")
async def tool_rename_file(
    path: str,
    newName: str,
    overwrite: bool = False,
) -> str:
    try:
        res = GloscTools.rename_file(
            {"path": path, "newName": newName, "overwrite": overwrite}
        )
        return json.dumps(res, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"重命名失败: {e}"


@mcp.tool(name="moveFile", description="移动文件到新路径（必要时自动创建目录）")
async def tool_move_file(
    from_: Annotated[str, Field(alias="from")],
    to: str,
    overwrite: bool = False,
    createDirs: bool = True,
) -> str:
    try:
        res = GloscTools.move_file(
            {
                "from": from_,
                "to": to,
                "overwrite": overwrite,
                "createDirs": createDirs,
            }
        )
        return json.dumps(res, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"移动失败: {e}"


@mcp.tool(name="listFilesRecursive", description="递归获取文件夹中的所有文件")
async def tool_list_files_recursive(dir: str, limit: int = 5000) -> str:
    try:
        res = GloscTools.list_files_recursive({"dir": dir, "limit": limit})
        return json.dumps(res, ensure_ascii=False, indent=2)
    except Exception as e:
        return f"列出文件失败: {e}"


def main():
    # Initialize and run the server
    mcp.run(transport='stdio')

if __name__ == "__main__":
    main()
