#  Glosc Mcp Tools

适用于 Glosc Copilot 的 Mcp 工具集。

## Tools

- `listApps`
	- 获取已安装应用列表（Windows 注册表）
	- 入参：`{ query?: string, matchMode?: "contains"|"equals"|"regex", limit?: number }`

- `getAppInstallPath`
	- 获取应用安装路径（优先 `InstallLocation`，否则从 `DisplayIcon`/卸载命令推断）
	- 入参：`{ name: string, matchMode?: "contains"|"equals"|"regex", allMatches?: boolean, limit?: number }`

- `openRef`
	- 打开引用（文件/文件夹/URL/可执行文件），使用系统默认方式打开（Windows 下使用 `Start-Process`）
	- 入参：`{ target: string, args?: string[], wait?: boolean }`